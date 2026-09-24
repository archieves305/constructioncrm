import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ComposeModule } from "./compose";
import type { ChecklistItemDef, ScopeToggleSpec, TaskCondition } from "./templates/types";

/**
 * Template versions as the compose engine wants them. Reads the flat rows
 * back into the same `TemplateDefinition` shape `defineTemplate` produces,
 * so seeded and editor-built versions compose identically.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const VERSION_TREE_INCLUDE = {
  template: { select: { id: true, key: true, name: true, kind: true, trade: true, description: true } },
  phases: { orderBy: { sortOrder: "asc" } },
  tasks: { orderBy: { sortOrder: "asc" } },
  dependencies: true,
} satisfies Prisma.WorkflowTemplateVersionInclude;

export type VersionTree = Prisma.WorkflowTemplateVersionGetPayload<{ include: typeof VERSION_TREE_INCLUDE }>;

export function readScopeToggles(raw: Prisma.JsonValue): ScopeToggleSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) return [];
    const o = t as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") return [];
    return [{ key: o.key, label: o.label, description: typeof o.description === "string" ? o.description : undefined, default: o.default === true }];
  });
}

function readChecklistDef(raw: Prisma.JsonValue): ChecklistItemDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) return [];
    const o = t as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") return [];
    const c = o.condition && typeof o.condition === "object" ? (o.condition as TaskCondition) : null;
    return [{ key: o.key, label: o.label, condition: c }];
  });
}

export function toComposeModule(v: VersionTree): ComposeModule {
  const phaseKeyById = new Map(v.phases.map((p) => [p.id, p.key]));
  return {
    moduleKey: v.template.key,
    kind: v.template.kind,
    name: v.template.name,
    trade: v.template.trade,
    versionId: v.id,
    version: v.version,
    definition: {
      scopeToggles: readScopeToggles(v.scopeToggles),
      phases: v.phases.map((p) => ({
        key: p.key,
        name: p.name,
        band: p.band,
        sortOrder: p.sortOrder,
        description: p.description,
        note: p.note,
        conditionPermit: p.conditionPermit,
      })),
      tasks: v.tasks.map((t) => ({
        key: t.key,
        phaseKey: phaseKeyById.get(t.phaseId) ?? "",
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
        checklist: readChecklistDef(t.checklist),
        conditionPermit: t.conditionPermit,
        conditionAnyOf: t.conditionAnyOf,
        conditionAllOf: t.conditionAllOf,
        overridesCoreKey: t.overridesCoreKey,
        sortOrder: t.sortOrder,
      })),
      dependencies: v.dependencies.map((d) => ({ taskKey: d.taskKey, dependsOnRef: d.dependsOnRef, kind: d.kind })),
    },
  };
}

/** The current PUBLISHED version of a template, by key. */
export async function loadPublishedVersion(db: Db, templateKey: string): Promise<VersionTree | null> {
  return db.workflowTemplateVersion.findFirst({
    where: { template: { key: templateKey, isActive: true }, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    include: VERSION_TREE_INCLUDE,
  });
}

export async function loadVersionById(db: Db, versionId: string): Promise<VersionTree | null> {
  return db.workflowTemplateVersion.findUnique({ where: { id: versionId }, include: VERSION_TREE_INCLUDE });
}

/** The modules currently applied to an instance, at their pinned versions. */
export async function loadInstanceModules(db: Db, instanceId: string): Promise<ComposeModule[]> {
  const rows = await db.jobWorkflowModule.findMany({
    where: { instanceId, removedAt: null },
    orderBy: { addedAt: "asc" },
    include: { templateVersion: { include: VERSION_TREE_INCLUDE } },
  });
  return rows.map((r) => toComposeModule(r.templateVersion));
}
