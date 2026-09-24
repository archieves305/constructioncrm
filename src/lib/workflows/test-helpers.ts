import type { TemplateDefinition } from "./templates/types";
import type { VersionTree } from "./load";

/**
 * Test-only: a `TemplateDefinition` as the database would hand it back, so
 * engine tests that go through `loadInstanceModules` / `validateTree` can
 * run on the real seed specs without a database.
 */
export function fakeTree(def: TemplateDefinition, opts: { versionId?: string; version?: number; status?: VersionTree["status"] } = {}): VersionTree {
  const versionId = opts.versionId ?? `v-${def.key}-${opts.version ?? 1}`;
  const now = new Date("2026-09-01T00:00:00Z");
  const phases = def.phases.map((p, i) => ({
    id: `${versionId}:phase:${p.key}`,
    versionId,
    key: p.key,
    name: p.name,
    band: p.band,
    sortOrder: i,
    description: p.description,
    note: p.note,
    conditionPermit: p.conditionPermit,
  }));
  const phaseId = new Map(phases.map((p) => [p.key, p.id]));
  return {
    id: versionId,
    templateId: `t-${def.key}`,
    version: opts.version ?? 1,
    status: opts.status ?? "PUBLISHED",
    changeNotes: null,
    scopeToggles: def.scopeToggles as unknown as VersionTree["scopeToggles"],
    contentHash: "",
    sourceVersionId: null,
    createdByUserId: null,
    publishedByUserId: null,
    publishedAt: now,
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    template: { id: `t-${def.key}`, key: def.key, name: def.name, kind: def.kind, trade: def.trade, description: def.description },
    phases,
    tasks: def.tasks.map((t, i) => ({
      id: `${versionId}:task:${t.key}`,
      versionId,
      phaseId: phaseId.get(t.phaseKey)!,
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
      checklist: t.checklist as unknown as VersionTree["tasks"][number]["checklist"],
      conditionPermit: t.conditionPermit,
      conditionAnyOf: t.conditionAnyOf,
      conditionAllOf: t.conditionAllOf,
      overridesCoreKey: t.overridesCoreKey,
      sortOrder: i,
    })),
    dependencies: def.dependencies.map((d, i) => ({ id: `${versionId}:dep:${i}`, versionId, taskKey: d.taskKey, dependsOnRef: d.dependsOnRef, kind: d.kind })),
  };
}
