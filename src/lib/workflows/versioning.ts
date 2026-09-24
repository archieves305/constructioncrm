import type { Prisma, RoleName, WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { isValidKey } from "./keys";
import { slugKey } from "./slug";
import { VERSION_TREE_INCLUDE, toComposeModule, type VersionTree } from "./load";
import { contentHash } from "./seed";
import { validateVersion } from "./validate";
import type { TemplateDefinition } from "./templates/types";

/**
 * Template versioning for the editor.
 *
 * A PUBLISHED version is immutable: jobs pin it. Editing means creating a
 * DRAFT (a copy of the current published tree), changing that, validating,
 * and publishing — which supersedes the previous version. Jobs already on
 * the old version stay there until someone upgrades them from the
 * Workflow tab; new applies take the new one.
 */

export class VersioningError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "VersioningError";
  }
}

type Actor = { id: string; role: RoleName };

async function loadTree(versionId: string): Promise<VersionTree> {
  const v = await prisma.workflowTemplateVersion.findUnique({ where: { id: versionId }, include: VERSION_TREE_INCLUDE });
  if (!v) throw new VersioningError(404, "Version not found");
  return v;
}

/** Every mutation of phases, steps and dependencies must be on a DRAFT. */
export async function requireDraft(versionId: string): Promise<VersionTree> {
  const v = await loadTree(versionId);
  if (v.status !== "DRAFT") throw new VersioningError(409, `v${v.version} is ${v.status.toLowerCase()} — create a draft to change it`);
  return v;
}

async function copyTree(tx: Prisma.TransactionClient, from: VersionTree, toVersionId: string) {
  const phaseIds = new Map<string, string>();
  for (const p of from.phases) {
    const row = await tx.workflowPhase.create({
      data: { versionId: toVersionId, key: p.key, name: p.name, band: p.band, sortOrder: p.sortOrder, description: p.description, note: p.note, conditionPermit: p.conditionPermit },
    });
    phaseIds.set(p.id, row.id);
  }
  if (from.tasks.length > 0) {
    await tx.workflowTaskTemplate.createMany({
      data: from.tasks.map((t) => ({
        versionId: toVersionId,
        phaseId: phaseIds.get(t.phaseId)!,
        key: t.key,
        title: t.title,
        description: t.description,
        role: t.role,
        priority: t.priority,
        anchor: t.anchor,
        dueOffsetBusinessDays: t.dueOffsetBusinessDays,
        durationBusinessDays: t.durationBusinessDays,
        autoActivate: t.autoActivate,
        blocking: t.blocking,
        requiredEvidence: t.requiredEvidence,
        requiredEvidenceParam: t.requiredEvidenceParam,
        checklist: t.checklist as Prisma.InputJsonValue,
        conditionPermit: t.conditionPermit,
        conditionAnyOf: t.conditionAnyOf,
        conditionAllOf: t.conditionAllOf,
        overridesCoreKey: t.overridesCoreKey,
        sortOrder: t.sortOrder,
      })),
    });
  }
  if (from.dependencies.length > 0) {
    await tx.workflowTaskDependency.createMany({
      data: from.dependencies.map((d) => ({ versionId: toVersionId, taskKey: d.taskKey, dependsOnRef: d.dependsOnRef, kind: d.kind })),
      skipDuplicates: true,
    });
  }
}

/** A new DRAFT copied from the current published version (or `fromVersionId`). 409 if a draft exists. */
export async function createDraft(templateId: string, actor: Actor, fromVersionId?: string): Promise<VersionTree> {
  const template = await prisma.workflowTemplate.findUnique({
    where: { id: templateId },
    include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true } } },
  });
  if (!template) throw new VersioningError(404, "Template not found");
  const existingDraft = template.versions.find((v) => v.status === "DRAFT");
  if (existingDraft) throw new VersioningError(409, `v${existingDraft.version} is already a draft — edit that one`);
  const sourceId = fromVersionId ?? template.versions.find((v) => v.status === "PUBLISHED")?.id ?? template.versions[0]?.id ?? null;
  const source = sourceId ? await loadTree(sourceId) : null;
  const nextNumber = (template.versions[0]?.version ?? 0) + 1;

  const created = await prisma.$transaction(async (tx) => {
    const v = await tx.workflowTemplateVersion.create({
      data: {
        templateId,
        version: nextNumber,
        status: "DRAFT",
        contentHash: "",
        scopeToggles: (source?.scopeToggles ?? []) as Prisma.InputJsonValue,
        sourceVersionId: source?.id ?? null,
        createdByUserId: actor.id,
      },
    });
    if (source) await copyTree(tx, source, v.id);
    return v;
  });
  await recordAudit({ actorUserId: actor.id, entityType: "WorkflowTemplateVersion", entityId: created.id, action: "create", after: { templateId, version: nextNumber, from: source?.id ?? null } });
  return loadTree(created.id);
}

/** Validate, then PUBLISH; the previous published version becomes SUPERSEDED. */
export async function publishVersion(versionId: string, actor: Actor, changeNotes?: string | null): Promise<VersionTree> {
  const v = await requireDraft(versionId);
  const result = await validateVersion(versionId);
  if (!result.ok) {
    throw new VersioningError(400, `Fix ${result.issues.filter((i) => i.level === "error").length} problem(s) before publishing: ${result.issues.find((i) => i.level === "error")?.message}`);
  }
  const def = toComposeModule(v).definition;
  const hash = contentHash({ key: v.template.key, name: v.template.name, kind: v.template.kind, trade: v.template.trade, description: v.template.description, serviceCategoryNames: [], ...def } as TemplateDefinition);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.workflowTemplateVersion.updateMany({
      where: { templateId: v.templateId, status: "PUBLISHED" },
      data: { status: "SUPERSEDED", supersededAt: now },
    });
    await tx.workflowTemplateVersion.update({
      where: { id: versionId },
      data: { status: "PUBLISHED", publishedAt: now, publishedByUserId: actor.id, contentHash: hash, changeNotes: changeNotes ?? undefined },
    });
  });
  await recordAudit({ actorUserId: actor.id, entityType: "WorkflowTemplateVersion", entityId: versionId, action: "template_publish", after: { templateKey: v.template.key, version: v.version } });
  return loadTree(versionId);
}

/** ARCHIVE a draft or superseded version. The current published one cannot be archived. */
export async function archiveVersion(versionId: string, actor: Actor): Promise<VersionTree> {
  const v = await loadTree(versionId);
  if (v.status === "PUBLISHED") throw new VersioningError(409, "The published version cannot be archived — publish another first");
  if (v.status === "ARCHIVED") return v;
  await prisma.workflowTemplateVersion.update({ where: { id: versionId }, data: { status: "ARCHIVED" } });
  await recordAudit({ actorUserId: actor.id, entityType: "WorkflowTemplateVersion", entityId: versionId, action: "update", before: { status: v.status }, after: { status: "ARCHIVED" } });
  return loadTree(versionId);
}

export type TemplateMeta = { key: string; name: string; kind: "CORE" | "TRADE"; trade?: string | null; description?: string | null; isActive?: boolean; serviceCategoryIds?: string[] };

export async function createTemplate(meta: TemplateMeta, actor: Actor) {
  if (!isValidKey(meta.key)) throw new VersioningError(400, "Key must be lowercase letters, digits and underscores");
  if (meta.kind === "CORE") throw new VersioningError(400, "There is one Core template; duplicate a trade instead");
  const dup = await prisma.workflowTemplate.findUnique({ where: { key: meta.key } });
  if (dup) throw new VersioningError(409, `A template with key "${meta.key}" already exists`);
  const t = await prisma.workflowTemplate.create({
    data: {
      key: meta.key,
      name: meta.name.trim(),
      kind: "TRADE",
      trade: meta.trade?.trim() || meta.name.trim(),
      description: meta.description?.trim() || null,
      isActive: meta.isActive ?? true,
      versions: { create: { version: 1, status: "DRAFT", contentHash: "", scopeToggles: [], createdByUserId: actor.id } },
    },
    include: { versions: true },
  });
  if (meta.serviceCategoryIds?.length) await setServiceCategories(t.id, meta.serviceCategoryIds);
  await recordAudit({ actorUserId: actor.id, entityType: "WorkflowTemplate", entityId: t.id, action: "create", after: meta });
  return t;
}

export async function updateTemplateMeta(templateId: string, meta: Partial<Omit<TemplateMeta, "key" | "kind">>, actor: Actor) {
  const before = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
  if (!before) throw new VersioningError(404, "Template not found");
  const t = await prisma.workflowTemplate.update({
    where: { id: templateId },
    data: {
      ...(meta.name !== undefined ? { name: meta.name.trim() } : {}),
      ...(meta.trade !== undefined ? { trade: meta.trade?.trim() || null } : {}),
      ...(meta.description !== undefined ? { description: meta.description?.trim() || null } : {}),
      ...(meta.isActive !== undefined ? { isActive: meta.isActive } : {}),
    },
  });
  if (meta.serviceCategoryIds) await setServiceCategories(templateId, meta.serviceCategoryIds);
  await recordAudit({ actorUserId: actor.id, entityType: "WorkflowTemplate", entityId: templateId, action: "update", before, after: meta });
  return t;
}

async function setServiceCategories(templateId: string, ids: string[]) {
  await prisma.workflowTemplateServiceCategory.deleteMany({ where: { templateId } });
  if (ids.length > 0) await prisma.workflowTemplateServiceCategory.createMany({ data: ids.map((serviceCategoryId) => ({ templateId, serviceCategoryId })), skipDuplicates: true });
}

/** A new TRADE template whose v1 DRAFT is a copy of this template's published (or latest) version. */
export async function duplicateTemplate(templateId: string, meta: { key: string; name: string }, actor: Actor) {
  const src = await prisma.workflowTemplate.findUnique({
    where: { id: templateId },
    include: { versions: { orderBy: { version: "desc" }, select: { id: true, status: true } } },
  });
  if (!src) throw new VersioningError(404, "Template not found");
  if (!isValidKey(meta.key)) throw new VersioningError(400, "Key must be lowercase letters, digits and underscores");
  if (await prisma.workflowTemplate.findUnique({ where: { key: meta.key } })) throw new VersioningError(409, `A template with key "${meta.key}" already exists`);
  const sourceId = src.versions.find((v) => v.status === "PUBLISHED")?.id ?? src.versions[0]?.id;
  const source = sourceId ? await loadTree(sourceId) : null;
  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.workflowTemplate.create({
      data: { key: meta.key, name: meta.name.trim(), kind: "TRADE", trade: meta.name.trim(), description: src.description, isActive: true },
    });
    const v = await tx.workflowTemplateVersion.create({
      data: { templateId: t.id, version: 1, status: "DRAFT", contentHash: "", scopeToggles: (source?.scopeToggles ?? []) as Prisma.InputJsonValue, sourceVersionId: source?.id ?? null, createdByUserId: actor.id },
    });
    if (source) await copyTree(tx, source, v.id);
    return t;
  });
  await recordAudit({ actorUserId: actor.id, entityType: "WorkflowTemplate", entityId: created.id, action: "create", after: { duplicatedFrom: templateId, ...meta } });
  return created;
}

// ── Draft mutations ─────────────────────────────────────────────────────────

export type PhaseInput = { key?: string; name: string; band: number; description?: string | null; note?: string | null; conditionPermit?: "REQUIRED" | "NOT_REQUIRED" | null };

export { slugKey };

export async function addPhase(versionId: string, input: PhaseInput, actor: Actor) {
  const v = await requireDraft(versionId);
  const key = input.key?.trim() || slugKey(input.name);
  if (!isValidKey(key)) throw new VersioningError(400, "Phase key must be lowercase letters, digits and underscores");
  if (v.phases.some((p) => p.key === key)) throw new VersioningError(409, `Phase key "${key}" is already used`);
  const row = await prisma.workflowPhase.create({
    data: {
      versionId,
      key,
      name: input.name.trim(),
      band: input.band,
      sortOrder: v.phases.length,
      description: input.description?.trim() || null,
      note: input.note?.trim() || null,
      conditionPermit: input.conditionPermit ?? null,
    },
  });
  void actor;
  return row;
}

export async function updatePhase(versionId: string, phaseId: string, input: Partial<PhaseInput>, actor: Actor) {
  const v = await requireDraft(versionId);
  const phase = v.phases.find((p) => p.id === phaseId);
  if (!phase) throw new VersioningError(404, "Phase not found");
  if (input.key !== undefined && input.key !== phase.key) {
    if (!isValidKey(input.key)) throw new VersioningError(400, "Phase key must be lowercase letters, digits and underscores");
    if (v.phases.some((p) => p.key === input.key)) throw new VersioningError(409, `Phase key "${input.key}" is already used`);
  }
  void actor;
  return prisma.workflowPhase.update({
    where: { id: phaseId },
    data: {
      ...(input.key !== undefined ? { key: input.key } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.band !== undefined ? { band: input.band } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      ...(input.conditionPermit !== undefined ? { conditionPermit: input.conditionPermit } : {}),
    },
  });
}

/** Deleting a phase deletes its steps and every dependency that pointed at them. */
export async function deletePhase(versionId: string, phaseId: string, actor: Actor) {
  const v = await requireDraft(versionId);
  const phase = v.phases.find((p) => p.id === phaseId);
  if (!phase) throw new VersioningError(404, "Phase not found");
  const keys = v.tasks.filter((t) => t.phaseId === phaseId).map((t) => t.key);
  await prisma.$transaction([
    prisma.workflowTaskDependency.deleteMany({ where: { versionId, OR: [{ taskKey: { in: keys } }, { dependsOnRef: { in: keys } }] } }),
    prisma.workflowPhase.delete({ where: { id: phaseId } }),
  ]);
  void actor;
  return { deletedSteps: keys.length };
}

export async function reorderPhases(versionId: string, phaseIds: string[], actor: Actor) {
  const v = await requireDraft(versionId);
  const known = new Set(v.phases.map((p) => p.id));
  if (phaseIds.length !== known.size || !phaseIds.every((id) => known.has(id))) throw new VersioningError(400, "Reorder must list every phase exactly once");
  await prisma.$transaction(phaseIds.map((id, i) => prisma.workflowPhase.update({ where: { id }, data: { sortOrder: i } })));
  void actor;
}

export type TaskInput = {
  phaseId: string;
  key?: string;
  title: string;
  description?: string | null;
  role: WorkflowRole;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  anchor?: "JOB_CREATED" | "APPLIED_AT" | "TARGET_START" | "PHASE_START" | "PREDECESSOR";
  dueOffsetBusinessDays?: number;
  durationBusinessDays?: number | null;
  autoActivate?: boolean;
  blocking?: boolean;
  requiredEvidence?: "ATTACHMENT" | "PHOTO" | "PERMIT_NUMBER" | "PERMIT_DETERMINATION" | "INSPECTION_RESULT" | "PAYMENT_STATUS" | "NOTE" | null;
  requiredEvidenceParam?: string | null;
  checklist?: { label: string; condition?: { anyOf?: string[]; allOf?: string[] } | null }[];
  conditionPermit?: "REQUIRED" | "NOT_REQUIRED" | null;
  conditionAnyOf?: string[];
  conditionAllOf?: string[];
  overridesCoreKey?: string | null;
  /** Full replacement of this step's dependencies. */
  dependsOn?: { ref: string; kind?: "BLOCKING" | "DATE_ONLY" }[];
};

function checklistJson(items: TaskInput["checklist"]): Prisma.InputJsonValue {
  return (items ?? []).map((c, i) => ({ key: `item_${i + 1}`, label: c.label.trim(), condition: c.condition ?? null }));
}

export async function addTask(versionId: string, input: TaskInput, actor: Actor) {
  const v = await requireDraft(versionId);
  if (!v.phases.some((p) => p.id === input.phaseId)) throw new VersioningError(404, "Phase not found");
  let key = input.key?.trim() || slugKey(input.title);
  if (!isValidKey(key)) throw new VersioningError(400, "Step key must be lowercase letters, digits and underscores");
  if (v.tasks.some((t) => t.key === key)) {
    if (input.key) throw new VersioningError(409, `Step key "${key}" is already used`);
    let n = 2;
    while (v.tasks.some((t) => t.key === `${key}_${n}`)) n++;
    key = `${key}_${n}`;
  }
  const sortOrder = v.tasks.filter((t) => t.phaseId === input.phaseId).length;
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.workflowTaskTemplate.create({
      data: {
        versionId,
        phaseId: input.phaseId,
        key,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        role: input.role,
        priority: input.priority ?? "MEDIUM",
        anchor: input.anchor ?? ((input.dependsOn?.length ?? 0) > 0 ? "PREDECESSOR" : "JOB_CREATED"),
        dueOffsetBusinessDays: input.dueOffsetBusinessDays ?? 2,
        durationBusinessDays: input.durationBusinessDays ?? null,
        autoActivate: input.autoActivate ?? true,
        blocking: input.blocking ?? false,
        requiredEvidence: input.requiredEvidence ?? null,
        requiredEvidenceParam: input.requiredEvidenceParam ?? null,
        checklist: checklistJson(input.checklist),
        conditionPermit: input.conditionPermit ?? null,
        conditionAnyOf: input.conditionAnyOf ?? [],
        conditionAllOf: input.conditionAllOf ?? [],
        overridesCoreKey: input.overridesCoreKey ?? null,
        sortOrder,
      },
    });
    if (input.dependsOn?.length) {
      await tx.workflowTaskDependency.createMany({
        data: input.dependsOn.map((d) => ({ versionId, taskKey: key, dependsOnRef: d.ref, kind: d.kind ?? "BLOCKING" })),
        skipDuplicates: true,
      });
    }
    return t;
  });
  void actor;
  return row;
}

export async function updateTaskTemplate(versionId: string, taskId: string, input: Partial<TaskInput>, actor: Actor) {
  const v = await requireDraft(versionId);
  const t = v.tasks.find((x) => x.id === taskId);
  if (!t) throw new VersioningError(404, "Step not found");
  if (input.phaseId !== undefined && !v.phases.some((p) => p.id === input.phaseId)) throw new VersioningError(404, "Phase not found");
  let key = t.key;
  if (input.key !== undefined && input.key.trim() !== t.key) {
    key = input.key.trim();
    if (!isValidKey(key)) throw new VersioningError(400, "Step key must be lowercase letters, digits and underscores");
    if (v.tasks.some((x) => x.key === key)) throw new VersioningError(409, `Step key "${key}" is already used`);
  }
  await prisma.$transaction(async (tx) => {
    if (key !== t.key) {
      // Renaming a key renames every reference to it.
      await tx.workflowTaskDependency.updateMany({ where: { versionId, taskKey: t.key }, data: { taskKey: key } });
      await tx.workflowTaskDependency.updateMany({ where: { versionId, dependsOnRef: t.key }, data: { dependsOnRef: key } });
    }
    await tx.workflowTaskTemplate.update({
      where: { id: taskId },
      data: {
        key,
        ...(input.phaseId !== undefined ? { phaseId: input.phaseId } : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.anchor !== undefined ? { anchor: input.anchor } : {}),
        ...(input.dueOffsetBusinessDays !== undefined ? { dueOffsetBusinessDays: input.dueOffsetBusinessDays } : {}),
        ...(input.durationBusinessDays !== undefined ? { durationBusinessDays: input.durationBusinessDays } : {}),
        ...(input.autoActivate !== undefined ? { autoActivate: input.autoActivate } : {}),
        ...(input.blocking !== undefined ? { blocking: input.blocking } : {}),
        ...(input.requiredEvidence !== undefined ? { requiredEvidence: input.requiredEvidence } : {}),
        ...(input.requiredEvidenceParam !== undefined ? { requiredEvidenceParam: input.requiredEvidenceParam } : {}),
        ...(input.checklist !== undefined ? { checklist: checklistJson(input.checklist) } : {}),
        ...(input.conditionPermit !== undefined ? { conditionPermit: input.conditionPermit } : {}),
        ...(input.conditionAnyOf !== undefined ? { conditionAnyOf: input.conditionAnyOf } : {}),
        ...(input.conditionAllOf !== undefined ? { conditionAllOf: input.conditionAllOf } : {}),
        ...(input.overridesCoreKey !== undefined ? { overridesCoreKey: input.overridesCoreKey } : {}),
      },
    });
    if (input.dependsOn !== undefined) {
      await tx.workflowTaskDependency.deleteMany({ where: { versionId, taskKey: key } });
      if (input.dependsOn.length > 0) {
        await tx.workflowTaskDependency.createMany({
          data: input.dependsOn.map((d) => ({ versionId, taskKey: key, dependsOnRef: d.ref, kind: d.kind ?? "BLOCKING" })),
          skipDuplicates: true,
        });
      }
    }
  });
  void actor;
  return prisma.workflowTaskTemplate.findUniqueOrThrow({ where: { id: taskId } });
}

export async function deleteTaskTemplate(versionId: string, taskId: string, actor: Actor) {
  const v = await requireDraft(versionId);
  const t = v.tasks.find((x) => x.id === taskId);
  if (!t) throw new VersioningError(404, "Step not found");
  await prisma.$transaction([
    prisma.workflowTaskDependency.deleteMany({ where: { versionId, OR: [{ taskKey: t.key }, { dependsOnRef: t.key }] } }),
    prisma.workflowTaskTemplate.delete({ where: { id: taskId } }),
  ]);
  void actor;
  return { key: t.key };
}

export async function reorderTasks(versionId: string, phaseId: string, taskIds: string[], actor: Actor) {
  const v = await requireDraft(versionId);
  const inPhase = new Set(v.tasks.filter((t) => t.phaseId === phaseId).map((t) => t.id));
  if (taskIds.length !== inPhase.size || !taskIds.every((id) => inPhase.has(id))) throw new VersioningError(400, "Reorder must list every step in the phase exactly once");
  await prisma.$transaction(taskIds.map((id, i) => prisma.workflowTaskTemplate.update({ where: { id }, data: { sortOrder: i } })));
  void actor;
}

export async function setScopeToggles(versionId: string, toggles: { key: string; label: string; description?: string; default: boolean }[], actor: Actor) {
  await requireDraft(versionId);
  const seen = new Set<string>();
  for (const t of toggles) {
    if (!isValidKey(t.key)) throw new VersioningError(400, `Toggle key "${t.key}" must be lowercase letters, digits and underscores`);
    if (seen.has(t.key)) throw new VersioningError(409, `Duplicate toggle "${t.key}"`);
    seen.add(t.key);
  }
  void actor;
  return prisma.workflowTemplateVersion.update({ where: { id: versionId }, data: { scopeToggles: toggles as unknown as Prisma.InputJsonValue } });
}

/** Modules on a job with a newer published version available. */
export async function availableUpgrades(modules: { templateKey: string; versionId: string; version: number }[]) {
  const out: { templateKey: string; from: number; to: number; versionId: string }[] = [];
  for (const m of modules) {
    const latest = await prisma.workflowTemplateVersion.findFirst({
      where: { template: { key: m.templateKey }, status: "PUBLISHED" },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
    if (latest && latest.id !== m.versionId && latest.version > m.version) out.push({ templateKey: m.templateKey, from: m.version, to: latest.version, versionId: latest.id });
  }
  return out;
}
