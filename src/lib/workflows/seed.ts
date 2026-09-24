import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { TemplateDefinition } from "./templates/types";

/**
 * Idempotent template seeding.
 *
 * Natural key is (templateKey, version). Unchanged content → no-op. Changed
 * content on a version no job references → rebuild the children in place
 * (dev convenience). Changed content on a version a job HAS applied → throw:
 * a pinned version is immutable, so the fix is to bump the version in the
 * spec file, not to rewrite history under live workflows.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export function contentHash(def: TemplateDefinition): string {
  // Service-category suggestions are metadata, not content: changing which
  // lead services suggest a template must not look like a template edit.
  const content = { ...def, serviceCategoryNames: undefined };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export type SeedOutcome = "created" | "unchanged" | "rebuilt";

export class SeedVersionInUseError extends Error {
  constructor(templateKey: string, version: number, jobs: number) {
    super(`${templateKey} v${version} is in use by ${jobs} job${jobs === 1 ? "" : "s"}; bump the version in the spec file instead of editing v${version}`);
    this.name = "SeedVersionInUseError";
  }
}

export async function upsertTemplateVersion(
  db: Db,
  def: TemplateDefinition,
  opts: { version: number; log?: (line: string) => void } ,
): Promise<{ outcome: SeedOutcome; versionId: string }> {
  const log = opts.log ?? (() => {});
  const hash = contentHash(def);

  const template = await db.workflowTemplate.upsert({
    where: { key: def.key },
    create: { key: def.key, name: def.name, kind: def.kind, trade: def.trade, description: def.description, isActive: true },
    update: { name: def.name, kind: def.kind, trade: def.trade, description: def.description, isActive: true },
  });

  // Service-category suggestions, by name; missing categories are skipped.
  if (def.serviceCategoryNames.length > 0) {
    const cats = await db.serviceCategory.findMany({ where: { name: { in: def.serviceCategoryNames } }, select: { id: true } });
    await db.workflowTemplateServiceCategory.deleteMany({ where: { templateId: template.id } });
    if (cats.length > 0) {
      await db.workflowTemplateServiceCategory.createMany({
        data: cats.map((c) => ({ templateId: template.id, serviceCategoryId: c.id })),
        skipDuplicates: true,
      });
    }
  }

  const existing = await db.workflowTemplateVersion.findUnique({
    where: { templateId_version: { templateId: template.id, version: opts.version } },
    select: { id: true, contentHash: true, _count: { select: { modules: true } } },
  });

  if (existing && existing.contentHash === hash) {
    log(`  ${def.key} v${opts.version}: unchanged`);
    return { outcome: "unchanged", versionId: existing.id };
  }
  if (existing && existing._count.modules > 0) {
    throw new SeedVersionInUseError(def.key, opts.version, existing._count.modules);
  }

  const version = existing
    ? await db.workflowTemplateVersion.update({
        where: { id: existing.id },
        data: { contentHash: hash, scopeToggles: def.scopeToggles as unknown as Prisma.InputJsonValue },
      })
    : await db.workflowTemplateVersion.create({
        data: {
          templateId: template.id,
          version: opts.version,
          status: "PUBLISHED",
          publishedAt: new Date(),
          contentHash: hash,
          scopeToggles: def.scopeToggles as unknown as Prisma.InputJsonValue,
          changeNotes: "Seeded",
        },
      });

  // Rebuild children deterministically (cascade removes tasks + deps).
  await db.workflowPhase.deleteMany({ where: { versionId: version.id } });
  await db.workflowTaskDependency.deleteMany({ where: { versionId: version.id } });

  const phaseIds = new Map<string, string>();
  for (const p of def.phases) {
    const row = await db.workflowPhase.create({
      data: {
        versionId: version.id,
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
      versionId: version.id,
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
      data: def.dependencies.map((d) => ({ versionId: version.id, taskKey: d.taskKey, dependsOnRef: d.dependsOnRef, kind: d.kind })),
      skipDuplicates: true,
    });
  }

  const outcome: SeedOutcome = existing ? "rebuilt" : "created";
  log(`  ${def.key} v${opts.version}: ${outcome} (${def.phases.length} phases, ${def.tasks.length} tasks)`);
  return { outcome, versionId: version.id };
}
