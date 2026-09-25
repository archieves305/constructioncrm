import type {
  Priority,
  TaskDependencyKind,
  WorkflowAnchor,
  WorkflowEvidenceType,
  WorkflowPermitCondition,
  WorkflowPermitStatus,
  WorkflowRole,
  WorkflowTemplateKind,
} from "@/generated/prisma/client";
import { CORE_MODULE_KEY, fullKey, isBaseKind, permitGateKeyFor, resolveRef, type ScopeToggleState } from "./keys";
import { findCycle, type DepEdge } from "./dependencies";
import type { TaskCondition, TemplateDefinition } from "./templates/types";

/**
 * Turn the applied template versions + the job's permit status + its scope
 * toggles into a concrete plan: which tasks exist, in what order, waiting on
 * what. Pure — `apply` and `reconcile` both diff its output against the
 * tasks a job already has.
 *
 * Rules that are easy to get wrong, written down once:
 *  - A permit-conditioned task is excluded while the status is UNDETERMINED
 *    and anything that depended on it waits on "Determine permit
 *    requirement" instead.
 *  - Any other excluded task (wrong permit branch, scope toggle off) is
 *    BYPASSED: its dependents inherit its predecessors, transitively. So
 *    turning "Tear-off" off does not orphan "Install", "Rough inspections if
 *    required" drops out of a no-permit chain without breaking it, and
 *    "Mobilize" — which lists both branches' gates — ends up waiting on
 *    whichever gate exists (the other collapses to the already-completed
 *    determination task).
 *  - A trade task with `overridesCoreKey` suppresses that Core task and takes
 *    over its incoming edges.
 *  - Phases interleave by band; within a band the base module (Core on a
 *    job, the VIOLATION template on a case) comes first.
 */

export type ComposeModule = {
  moduleKey: string;
  kind: WorkflowTemplateKind;
  name: string;
  trade: string | null;
  versionId: string;
  version: number;
  definition: Pick<TemplateDefinition, "phases" | "tasks" | "dependencies" | "scopeToggles">;
};

export type ComposeInput = {
  modules: ComposeModule[];
  permitStatus: WorkflowPermitStatus;
  scopeToggles: ScopeToggleState;
};

export type ExclusionReason = "permit-undetermined" | "permit-mismatch" | "scope" | "overridden";

export type ComposedDependency = { key: string; kind: TaskDependencyKind };

export type ComposedTask = {
  key: string;
  moduleKey: string;
  shortKey: string;
  phaseKey: string;
  title: string;
  description: string | null;
  role: WorkflowRole;
  priority: Priority;
  anchor: WorkflowAnchor;
  dueOffsetBusinessDays: number;
  durationBusinessDays: number | null;
  autoActivate: boolean;
  blocking: boolean;
  requiredEvidence: WorkflowEvidenceType | null;
  requiredEvidenceParam: string | null;
  checklist: { key: string; label: string }[];
  conditionPermit: WorkflowPermitCondition | null;
  overridesCoreKey: string | null;
  sortOrder: number;
  dependsOn: ComposedDependency[];
  /** No BLOCKING predecessors and autoActivate → Ready as soon as it is created. */
  initiallyActive: boolean;
};

export type ComposedPhase = {
  key: string;
  moduleKey: string;
  moduleName: string;
  shortKey: string;
  name: string;
  band: number;
  description: string | null;
  note: string | null;
  conditionPermit: WorkflowPermitCondition | null;
  sortOrder: number;
  taskKeys: string[];
};

export type ComposedPlan = {
  modules: { moduleKey: string; kind: WorkflowTemplateKind; name: string; trade: string | null; versionId: string; version: number }[];
  phases: ComposedPhase[];
  tasks: ComposedTask[];
  edges: DepEdge<string>[];
  excluded: { key: string; reason: ExclusionReason }[];
  warnings: string[];
  /** The permit-determination gate this plan routes undetermined branches to ("core:…" on a job). */
  permitGateKey: string | null;
};

export class ComposeCycleError extends Error {
  constructor(public readonly path: string[]) {
    super(`Dependency cycle across the composed workflow: ${path.join(" → ")}`);
    this.name = "ComposeCycleError";
  }
}

/** Effective toggle values for one module: job override, else the version default. */
export function resolveToggles(module: ComposeModule, jobToggles: ScopeToggleState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const overrides = jobToggles[module.moduleKey] ?? {};
  for (const t of module.definition.scopeToggles) {
    out[t.key] = overrides[t.key] ?? t.default;
  }
  return out;
}

export function scopeConditionMet(c: TaskCondition, toggles: Record<string, boolean>): boolean {
  if (c.anyOf?.length && !c.anyOf.some((k) => toggles[k] === true)) return false;
  if (c.allOf?.length && !c.allOf.every((k) => toggles[k] === true)) return false;
  return true;
}

export function permitConditionMet(
  cond: WorkflowPermitCondition | null,
  status: WorkflowPermitStatus,
): true | "permit-undetermined" | "permit-mismatch" {
  if (!cond) return true;
  if (status === "UNDETERMINED") return "permit-undetermined";
  return cond === status ? true : "permit-mismatch";
}

type Candidate = {
  task: ComposedTask;
  rawDeps: ComposedDependency[];
  excluded: ExclusionReason | null;
};

export function compose(input: ComposeInput): ComposedPlan {
  const warnings: string[] = [];
  // The base module first, then the trades in the order given.
  const modules = [...input.modules].sort((a, b) => Number(isBaseKind(b.kind)) - Number(isBaseKind(a.kind)));
  const moduleIndex = new Map(modules.map((m, i) => [m.moduleKey, i]));
  const permitGateKey = permitGateKeyFor(modules);

  const candidates = new Map<string, Candidate>();
  const overriders = new Map<string, string[]>(); // core full key → trade full keys

  for (const m of modules) {
    const toggles = resolveToggles(m, input.scopeToggles);
    const depsByTask = new Map<string, ComposedDependency[]>();
    for (const d of m.definition.dependencies) {
      const list = depsByTask.get(d.taskKey) ?? [];
      list.push({ key: resolveRef(d.dependsOnRef, m.moduleKey), kind: d.kind });
      depsByTask.set(d.taskKey, list);
    }
    for (const t of m.definition.tasks) {
      const key = fullKey(m.moduleKey, t.key);
      let excluded: ExclusionReason | null = null;
      const permit = permitConditionMet(t.conditionPermit, input.permitStatus);
      if (permit !== true) excluded = permit;
      else if (!scopeConditionMet({ anyOf: t.conditionAnyOf, allOf: t.conditionAllOf }, toggles)) excluded = "scope";

      const checklist = t.checklist
        .filter((item) => {
          if (!item.condition) return true;
          if (item.condition.permit && permitConditionMet(item.condition.permit, input.permitStatus) !== true) return false;
          return scopeConditionMet(item.condition, toggles);
        })
        .map((item) => ({ key: item.key, label: item.label }));

      const overridesCoreKey = t.overridesCoreKey ? fullKey(CORE_MODULE_KEY, t.overridesCoreKey) : null;
      candidates.set(key, {
        excluded,
        rawDeps: depsByTask.get(t.key) ?? [],
        task: {
          key,
          moduleKey: m.moduleKey,
          shortKey: t.key,
          phaseKey: fullKey(m.moduleKey, t.phaseKey),
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
          checklist,
          conditionPermit: t.conditionPermit,
          overridesCoreKey,
          sortOrder: t.sortOrder,
          dependsOn: [],
          initiallyActive: false,
        },
      });
    }
  }

  // Overrides: a surviving trade task suppresses the Core task it replaces.
  for (const c of candidates.values()) {
    if (c.excluded || !c.task.overridesCoreKey) continue;
    const core = candidates.get(c.task.overridesCoreKey);
    if (!core) {
      warnings.push(`${c.task.key} overrides ${c.task.overridesCoreKey}, which is not in this workflow`);
      continue;
    }
    if (core.excluded && core.excluded !== "overridden") continue;
    core.excluded = "overridden";
    const list = overriders.get(core.task.key) ?? [];
    list.push(c.task.key);
    overriders.set(core.task.key, list);
  }

  // Edge resolution.
  const resolveTarget = (target: string, visited: Set<string>): string[] => {
    const c = candidates.get(target);
    if (!c) {
      warnings.push(`Dependency on "${target}" dropped: not part of this workflow`);
      return [];
    }
    if (!c.excluded) return [target];
    switch (c.excluded) {
      case "overridden":
        return (overriders.get(target) ?? []).filter((k) => !candidates.get(k)?.excluded);
      case "permit-undetermined": {
        const gate = permitGateKey ? candidates.get(permitGateKey) : undefined;
        if (gate && !gate.excluded) return [permitGateKey!];
        warnings.push(`Dependency on "${target}" dropped: permit status undetermined and no gate task`);
        return [];
      }
      case "permit-mismatch":
      case "scope": {
        if (visited.has(target)) return [];
        visited.add(target);
        return c.rawDeps.flatMap((d) => resolveTarget(d.key, visited));
      }
    }
  };

  const edges: DepEdge<string>[] = [];
  for (const c of candidates.values()) {
    if (c.excluded) continue;
    const seen = new Map<string, TaskDependencyKind>();
    for (const d of c.rawDeps) {
      for (const target of resolveTarget(d.key, new Set([c.task.key]))) {
        if (target === c.task.key) continue;
        const prev = seen.get(target);
        if (prev === "BLOCKING") continue;
        seen.set(target, d.kind === "BLOCKING" ? "BLOCKING" : (prev ?? d.kind));
      }
    }
    c.task.dependsOn = Array.from(seen, ([key, kind]) => ({ key, kind }));
    for (const dep of c.task.dependsOn) edges.push({ task: c.task.key, dependsOn: dep.key, kind: dep.kind });
    c.task.initiallyActive = c.task.autoActivate && !c.task.dependsOn.some((d) => d.kind === "BLOCKING");
  }

  const surviving = Array.from(candidates.values()).filter((c) => !c.excluded);
  const cycle = findCycle(surviving.map((c) => c.task.key), edges);
  if (cycle) throw new ComposeCycleError(cycle);

  // Phases: only those with a surviving task, ordered by band, Core first,
  // then module order, then the phase's own position.
  const phases: ComposedPhase[] = [];
  for (const m of modules) {
    for (const p of m.definition.phases) {
      const key = fullKey(m.moduleKey, p.key);
      const taskKeys = surviving
        .filter((c) => c.task.phaseKey === key)
        .sort((a, b) => a.task.sortOrder - b.task.sortOrder)
        .map((c) => c.task.key);
      if (taskKeys.length === 0) continue;
      phases.push({
        key,
        moduleKey: m.moduleKey,
        moduleName: m.name,
        shortKey: p.key,
        name: p.name,
        band: p.band,
        description: p.description,
        note: p.note,
        conditionPermit: p.conditionPermit,
        sortOrder: p.sortOrder,
        taskKeys,
      });
    }
  }
  phases.sort(
    (a, b) =>
      a.band - b.band ||
      moduleIndex.get(a.moduleKey)! - moduleIndex.get(b.moduleKey)! ||
      a.sortOrder - b.sortOrder,
  );

  const tasks: ComposedTask[] = [];
  let n = 0;
  for (const p of phases) {
    for (const k of p.taskKeys) {
      const t = candidates.get(k)!.task;
      t.sortOrder = (n += 1) * 10;
      tasks.push(t);
    }
  }

  return {
    modules: modules.map((m) => ({
      moduleKey: m.moduleKey,
      kind: m.kind,
      name: m.name,
      trade: m.trade,
      versionId: m.versionId,
      version: m.version,
    })),
    phases,
    tasks,
    edges,
    excluded: Array.from(candidates.values())
      .filter((c) => c.excluded)
      .map((c) => ({ key: c.task.key, reason: c.excluded! })),
    warnings,
    permitGateKey,
  };
}
