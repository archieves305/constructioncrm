import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, WorkflowVersionStatus } from "@/generated/prisma/client";
import type { TemplateDefinition } from "./templates/types";

/**
 * Idempotent template seeding, by GENERATION.
 *
 * A template's seeded content comes in generations (the original long-form
 * workflow, then the streamlined one). A generation is recognised by its
 * content hash, never by a version number: the admin editor mints version
 * numbers too, so "v2" may already be somebody's published edit.
 *
 *  - Hash found                → unchanged, whatever its number or status.
 *  - Not found, never seeded   → created at the next free number, PUBLISHED,
 *                                and every other published version of the
 *                                template is superseded.
 *  - Seeded before, content changed, no job pins it → rebuilt in place (a
 *    dev convenience while a generation is being written).
 *  - Seeded before, content changed, pinned → throw: a pinned version is
 *    immutable, so the change belongs in a new generation.
 *
 * A seeded generation has no `sourceVersionId`: it starts a new lineage, so
 * a job on the previous generation is never offered it as an in-place
 * "upgrade" (see `descendsFrom` in versioning.ts) — those jobs move by
 * migration.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export function contentHash(def: TemplateDefinition): string {
  // Service-category suggestions are metadata, not content: changing which
  // lead services suggest a template must not look like a template edit.
  const content = { ...def, serviceCategoryNames: undefined };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export class SeedVersionInUseError extends Error {
  constructor(templateKey: string, version: number, jobs: number) {
    super(`${templateKey} v${version} is in use by ${jobs} job${jobs === 1 ? "" : "s"}; add a new generation in prisma/seeds/workflows instead of editing the one it pins`);
    this.name = "SeedVersionInUseError";
  }
}

/** The note a seeded version carries; generation 1 keeps the note it was first seeded with. */
export function seedNote(generation: number): string {
  return generation === 1 ? "Seeded" : `Seeded (generation ${generation})`;
}

export type ExistingVersion = {
  id: string;
  version: number;
  status: WorkflowVersionStatus;
  contentHash: string;
  changeNotes: string | null;
  /** Jobs and cases pinned to this version. */
  pins: number;
};

export type GenerationAction =
  | { generation: number; kind: "unchanged"; version: number; versionId: string }
  | { generation: number; kind: "rebuild"; version: number; versionId: string }
  | { generation: number; kind: "create"; version: number };

export type SeedPlan = {
  actions: GenerationAction[];
  /** Published versions a newly created generation replaces. `seeded: false` = published from the editor. */
  supersede: { id: string; version: number; seeded: boolean }[];
  /** Open drafts, reported and left alone. */
  drafts: number[];
};

/**
 * Pure: what seeding `generations` (oldest first) does to a template that
 * already has `existing` versions.
 */
export function planGenerations(templateKey: string, existing: ExistingVersion[], generations: { generation: number; hash: string }[]): SeedPlan {
  const actions: GenerationAction[] = [];
  let next = existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const seedHashes = new Set(generations.map((g) => g.hash));
  let created = false;

  for (const g of generations) {
    const same = existing.find((v) => v.contentHash === g.hash && v.status !== "DRAFT");
    if (same) {
      actions.push({ generation: g.generation, kind: "unchanged", version: same.version, versionId: same.id });
      continue;
    }
    const seededBefore = existing.find((v) => v.changeNotes === seedNote(g.generation) && v.status !== "DRAFT");
    if (seededBefore) {
      if (seededBefore.pins > 0) throw new SeedVersionInUseError(templateKey, seededBefore.version, seededBefore.pins);
      actions.push({ generation: g.generation, kind: "rebuild", version: seededBefore.version, versionId: seededBefore.id });
      continue;
    }
    actions.push({ generation: g.generation, kind: "create", version: next });
    next += 1;
    created = true;
  }

  // Only a newly created generation changes what is published; a re-run
  // must never un-publish an edit an admin published after the last seed.
  const kept = new Set(actions.flatMap((a) => (a.kind === "create" ? [] : [a.versionId])));
  const newest = actions.at(-1);
  const supersede =
    created && newest?.kind === "create"
      ? existing
          .filter((v) => v.status === "PUBLISHED")
          .map((v) => ({ id: v.id, version: v.version, seeded: kept.has(v.id) || seedHashes.has(v.contentHash) }))
      : [];

  return { actions, supersede, drafts: existing.filter((v) => v.status === "DRAFT").map((v) => v.version) };
}

async function writeChildren(db: Db, versionId: string, def: TemplateDefinition): Promise<void> {
  // Rebuild children deterministically (cascade removes tasks + deps).
  await db.workflowPhase.deleteMany({ where: { versionId } });
  await db.workflowTaskDependency.deleteMany({ where: { versionId } });

  const phaseIds = new Map<string, string>();
  for (const p of def.phases) {
    const row = await db.workflowPhase.create({
      data: {
        versionId,
        key: p.key,
        name: p.name,
        band: p.band,
        sortOrder: p.sortOrder,
        description: p.description,
        note: p.note,
        conditionPermit: p.conditionPermit,
      },
    });
    phaseIds.set(p.key, row.id);
  }
  await db.workflowTaskTemplate.createMany({
    data: def.tasks.map((t) => ({
      versionId,
      phaseId: phaseIds.get(t.phaseKey)!,
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
      checklist: t.checklist as unknown as Prisma.InputJsonValue,
      conditionPermit: t.conditionPermit,
      conditionAnyOf: t.conditionAnyOf,
      conditionAllOf: t.conditionAllOf,
      overridesCoreKey: t.overridesCoreKey,
      sortOrder: t.sortOrder,
    })),
  });
  if (def.dependencies.length > 0) {
    await db.workflowTaskDependency.createMany({
      data: def.dependencies.map((d) => ({ versionId, taskKey: d.taskKey, dependsOnRef: d.dependsOnRef, kind: d.kind })),
      skipDuplicates: true,
    });
  }
}

export type SeedResult = { templateKey: string; plan: SeedPlan; versionIds: Record<number, string> };

/**
 * Seed one template's generations. `dryRun` reads and reports, writes
 * nothing. The template's name, description and service-category
 * suggestions follow the newest generation.
 */
export async function seedTemplateGenerations(
  db: Db,
  templateKey: string,
  generations: readonly { generation: number; definition: TemplateDefinition }[],
  opts: { log?: (line: string) => void; dryRun?: boolean } = {},
): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const would = opts.dryRun ? "would be " : "";
  const newest = generations.at(-1)!.definition;
  if (generations.some((g) => g.definition.key !== templateKey)) throw new Error(`${templateKey}: every generation must use the template's key`);

  let template = await db.workflowTemplate.findUnique({ where: { key: templateKey }, select: { id: true } });
  if (!opts.dryRun) {
    const meta = { name: newest.name, kind: newest.kind, trade: newest.trade, description: newest.description, isActive: true };
    template = await db.workflowTemplate.upsert({ where: { key: templateKey }, create: { key: templateKey, ...meta }, update: meta, select: { id: true } });

    // Service-category suggestions, by name; missing categories are skipped.
    if (newest.serviceCategoryNames.length > 0) {
      const cats = await db.serviceCategory.findMany({ where: { name: { in: newest.serviceCategoryNames } }, select: { id: true } });
      await db.workflowTemplateServiceCategory.deleteMany({ where: { templateId: template.id } });
      if (cats.length > 0) {
        await db.workflowTemplateServiceCategory.createMany({
          data: cats.map((c) => ({ templateId: template!.id, serviceCategoryId: c.id })),
          skipDuplicates: true,
        });
      }
    }
  }

  const rows = template
    ? await db.workflowTemplateVersion.findMany({
        where: { templateId: template.id },
        select: { id: true, version: true, status: true, contentHash: true, changeNotes: true, _count: { select: { modules: true } } },
        orderBy: { version: "asc" },
      })
    : [];
  const existing: ExistingVersion[] = rows.map((r) => ({ id: r.id, version: r.version, status: r.status, contentHash: r.contentHash, changeNotes: r.changeNotes, pins: r._count.modules }));
  const hashed = generations.map((g) => ({ ...g, hash: contentHash(g.definition) }));
  const plan = planGenerations(templateKey, existing, hashed);
  const versionIds: Record<number, string> = {};

  for (const action of plan.actions) {
    const g = hashed.find((x) => x.generation === action.generation)!;
    const def = g.definition;
    const size = `${def.phases.length} phases, ${def.tasks.length} tasks`;
    if (action.kind === "unchanged") {
      versionIds[g.generation] = action.versionId;
      log(`  ${templateKey}: generation ${g.generation} = v${action.version}, unchanged`);
      continue;
    }
    if (action.kind === "rebuild") {
      versionIds[g.generation] = action.versionId;
      if (!opts.dryRun) {
        await db.workflowTemplateVersion.update({
          where: { id: action.versionId },
          data: { contentHash: g.hash, scopeToggles: def.scopeToggles as unknown as Prisma.InputJsonValue },
        });
        await writeChildren(db, action.versionId, def);
      }
      log(`  ${templateKey}: generation ${g.generation} = v${action.version}, ${would}rebuilt (${size})`);
      continue;
    }
    if (!opts.dryRun) {
      const now = new Date();
      // Only the newest generation is published; an older one created on a
      // fresh database exists for the record (and for tests that pin it).
      const isNewest = g.generation === hashed.at(-1)!.generation;
      const row = await db.workflowTemplateVersion.create({
        data: {
          templateId: template!.id,
          version: action.version,
          status: isNewest ? "PUBLISHED" : "SUPERSEDED",
          publishedAt: now,
          supersededAt: isNewest ? null : now,
          contentHash: g.hash,
          scopeToggles: def.scopeToggles as unknown as Prisma.InputJsonValue,
          changeNotes: seedNote(g.generation),
        },
      });
      await writeChildren(db, row.id, def);
      if (isNewest) {
        await db.workflowTemplateVersion.updateMany({
          where: { templateId: template!.id, status: "PUBLISHED", id: { not: row.id } },
          data: { status: "SUPERSEDED", supersededAt: now },
        });
      }
      versionIds[g.generation] = row.id;
    }
    log(`  ${templateKey}: generation ${g.generation} = v${action.version}, ${would}created (${size})`);
  }

  for (const s of plan.supersede) {
    log(
      s.seeded
        ? `  ${templateKey}: v${s.version} ${would}superseded`
        : `  ${templateKey}: v${s.version} ${would}superseded — NOT a seeded version (published from the editor); its changes are not in the new generation`,
    );
  }
  for (const v of plan.drafts) log(`  ${templateKey}: v${v} is an open draft, left alone`);

  return { templateKey, plan, versionIds };
}
