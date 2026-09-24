import type { WorkflowAnchor } from "@/generated/prisma/client";
import { CORE_MODULE_KEY, DETERMINE_PERMIT_TASK_KEY, isValidKey } from "../keys";
import { findCycle, type DepEdge } from "../dependencies";
import type {
  ChecklistItemDef,
  DependencyDef,
  PhaseDef,
  TaskCondition,
  TaskDef,
  TemplateDefinition,
  TemplateSpec,
} from "./types";

/**
 * Validate and normalise a template spec.
 *
 * Every rule here throws with a path ("roofing › phases.permitting › tasks.
 * permit_submit › dependsOn[0]") so a broken seed file fails at load, not
 * on the first job somebody applies it to. The same checks back the Stage 2
 * editor's Validate button.
 */

export class TemplateDefinitionError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "TemplateDefinitionError";
  }
}

const DEFAULT_OFFSET_BUSINESS_DAYS = 2;

export function defineTemplate(spec: TemplateSpec): TemplateDefinition {
  const root = spec.key || "<template>";
  const fail = (path: string, message: string): never => {
    throw new TemplateDefinitionError(`${root} › ${path}`, message);
  };

  if (!isValidKey(spec.key)) fail("key", `"${spec.key}" must be lowercase letters, digits and underscores`);
  if (!spec.name?.trim()) fail("name", "is required");
  if (spec.kind === "TRADE" && !spec.trade?.trim()) fail("trade", "is required on a TRADE template");
  if (spec.kind === "CORE" && spec.key !== CORE_MODULE_KEY) fail("key", `a CORE template must use the key "${CORE_MODULE_KEY}"`);
  if (spec.kind === "TRADE" && spec.key === CORE_MODULE_KEY) fail("key", `"${CORE_MODULE_KEY}" is reserved for the Core template`);
  if (!spec.phases?.length) fail("phases", "at least one phase is required");

  const toggles = spec.scopeToggles ?? [];
  const toggleKeys = new Set<string>();
  toggles.forEach((t, i) => {
    if (!isValidKey(t.key)) fail(`scopeToggles[${i}].key`, `"${t.key}" is not a valid key`);
    if (toggleKeys.has(t.key)) fail(`scopeToggles[${i}].key`, `duplicate toggle "${t.key}"`);
    if (!t.label?.trim()) fail(`scopeToggles[${i}].label`, "is required");
    if (typeof t.default !== "boolean") fail(`scopeToggles[${i}].default`, "must be true or false");
    toggleKeys.add(t.key);
  });

  const checkCondition = (c: TaskCondition | undefined, path: string) => {
    for (const list of ["anyOf", "allOf"] as const) {
      for (const k of c?.[list] ?? []) {
        if (!toggleKeys.has(k)) fail(`${path}.${list}`, `unknown scope toggle "${k}"`);
      }
    }
  };

  const phases: PhaseDef[] = [];
  const tasks: TaskDef[] = [];
  const dependencies: DependencyDef[] = [];
  const taskKeys = new Set<string>();
  const phaseKeys = new Set<string>();
  // Refs are checked after every task is known, so forward references work.
  const pendingRefs: { taskKey: string; ref: string; path: string }[] = [];

  spec.phases.forEach((phase, pi) => {
    const ppath = `phases.${phase.key || pi}`;
    if (!isValidKey(phase.key)) fail(`${ppath}.key`, `"${phase.key}" is not a valid key`);
    if (phaseKeys.has(phase.key)) fail(`${ppath}.key`, `duplicate phase "${phase.key}"`);
    phaseKeys.add(phase.key);
    if (!phase.name?.trim()) fail(`${ppath}.name`, "is required");
    if (!Number.isInteger(phase.band) || phase.band <= 0) fail(`${ppath}.band`, "must be a positive integer");
    if (phase.permit === "NOT_REQUIRED" && !phase.note?.trim()) {
      fail(`${ppath}.note`, "a No-Permit phase must carry the legal warning as its note");
    }
    if (!phase.tasks?.length) fail(`${ppath}.tasks`, "a phase needs at least one task");

    phases.push({
      key: phase.key,
      name: phase.name.trim(),
      band: phase.band,
      sortOrder: pi,
      description: phase.description?.trim() || null,
      note: phase.note?.trim() || null,
      conditionPermit: phase.permit ?? null,
    });

    const inPhaseKeys = new Set(phase.tasks.map((t) => t.key));

    phase.tasks.forEach((task, ti) => {
      const tpath = `${ppath} › tasks.${task.key || ti}`;
      if (!isValidKey(task.key)) fail(`${tpath}.key`, `"${task.key}" is not a valid key`);
      if (taskKeys.has(task.key)) fail(`${tpath}.key`, `duplicate task "${task.key}"`);
      taskKeys.add(task.key);
      if (!task.title?.trim()) fail(`${tpath}.title`, "is required");
      if (!task.role) fail(`${tpath}.role`, "is required");

      if (task.condition?.permit && phase.permit && task.condition.permit !== phase.permit) {
        fail(`${tpath}.condition.permit`, `conflicts with the phase's permit branch (${phase.permit})`);
      }
      checkCondition(task.condition, `${tpath}.condition`);

      if (task.overridesCoreKey !== undefined) {
        if (spec.kind !== "TRADE") fail(`${tpath}.overridesCoreKey`, "only a TRADE task may override a Core task");
        if (!isValidKey(task.overridesCoreKey)) fail(`${tpath}.overridesCoreKey`, `"${task.overridesCoreKey}" is not a valid key`);
        if (task.overridesCoreKey === DETERMINE_PERMIT_TASK_KEY) {
          fail(`${tpath}.overridesCoreKey`, `"${DETERMINE_PERMIT_TASK_KEY}" is never overridden`);
        }
      }

      const offset = task.dueOffsetBusinessDays ?? DEFAULT_OFFSET_BUSINESS_DAYS;
      if (!Number.isInteger(offset)) fail(`${tpath}.dueOffsetBusinessDays`, "must be a whole number of business days");
      if (offset < 0 && task.anchor !== "TARGET_START") {
        fail(`${tpath}.dueOffsetBusinessDays`, "a negative offset only makes sense from TARGET_START");
      }
      if (task.durationBusinessDays !== undefined && (!Number.isInteger(task.durationBusinessDays) || task.durationBusinessDays < 0)) {
        fail(`${tpath}.durationBusinessDays`, "must be a non-negative whole number");
      }

      // Expand refs. `^` is the previous task in this phase.
      const expand = (refs: string[] | undefined, field: string): string[] =>
        (refs ?? []).map((ref, ri) => {
          const rpath = `${tpath}.${field}[${ri}]`;
          if (ref === "^") {
            if (ti === 0) fail(rpath, '"^" has no previous task in this phase');
            return phase.tasks[ti - 1]!.key;
          }
          if (ref.startsWith(`${CORE_MODULE_KEY}:`)) {
            if (spec.kind === "CORE") fail(rpath, "the Core template refers to its own tasks by bare key");
            const k = ref.slice(CORE_MODULE_KEY.length + 1);
            if (!isValidKey(k)) fail(rpath, `"${ref}" is not a valid reference`);
            return ref;
          }
          if (ref.includes(":")) fail(rpath, `"${ref}" — only core: cross-module references are allowed`);
          if (!isValidKey(ref)) fail(rpath, `"${ref}" is not a valid reference`);
          pendingRefs.push({ taskKey: task.key, ref, path: rpath });
          return ref;
        });

      const blockingRefs = expand(task.dependsOn, "dependsOn");
      const dateOnlyRefs = expand(task.dependsOnDateOnly, "dependsOnDateOnly");

      // Phase-level startsAfter applies to tasks with no in-phase blocking dep.
      const hasInPhaseDep = blockingRefs.some((r) => inPhaseKeys.has(r));
      const inherited = !hasInPhaseDep ? expand(phase.startsAfter, "startsAfter") : [];
      const allBlocking = Array.from(new Set([...blockingRefs, ...inherited]));
      for (const r of allBlocking) {
        if (r === task.key) fail(`${tpath}.dependsOn`, "a task cannot depend on itself");
        dependencies.push({ taskKey: task.key, dependsOnRef: r, kind: "BLOCKING" });
      }
      for (const r of dateOnlyRefs) {
        if (allBlocking.includes(r)) continue;
        if (r === task.key) fail(`${tpath}.dependsOnDateOnly`, "a task cannot depend on itself");
        dependencies.push({ taskKey: task.key, dependsOnRef: r, kind: "DATE_ONLY" });
      }

      const anchor: WorkflowAnchor = task.anchor ?? (allBlocking.length > 0 ? "PREDECESSOR" : "JOB_CREATED");

      const checklist: ChecklistItemDef[] = (task.checklist ?? []).map((item, ci) => {
        const text = typeof item === "string" ? item : item.text;
        if (!text?.trim()) fail(`${tpath}.checklist[${ci}]`, "is empty");
        const condition = typeof item === "string" ? null : (item.condition ?? null);
        if (condition) checkCondition(condition, `${tpath}.checklist[${ci}].condition`);
        return { key: `item_${ci + 1}`, label: text.trim(), condition };
      });

      tasks.push({
        key: task.key,
        phaseKey: phase.key,
        title: task.title.trim(),
        description: task.description?.trim() || null,
        role: task.role,
        priority: task.priority ?? "MEDIUM",
        anchor,
        dueOffsetBusinessDays: offset,
        durationBusinessDays: task.durationBusinessDays ?? null,
        autoActivate: task.autoActivate ?? true,
        blocking: task.blocking ?? false,
        requiredEvidence: task.requiredEvidence ?? null,
        requiredEvidenceParam: task.requiredEvidenceParam ?? null,
        checklist,
        conditionPermit: task.condition?.permit ?? phase.permit ?? null,
        conditionAnyOf: [...(task.condition?.anyOf ?? [])],
        conditionAllOf: [...(task.condition?.allOf ?? [])],
        overridesCoreKey: task.overridesCoreKey ?? null,
        sortOrder: ti,
      });
    });
  });

  for (const p of pendingRefs) {
    if (!taskKeys.has(p.ref)) fail(p.path, `unknown task "${p.ref}"`);
  }

  if (spec.kind === "CORE" && !taskKeys.has(DETERMINE_PERMIT_TASK_KEY)) {
    fail("tasks", `the Core template must contain "${DETERMINE_PERMIT_TASK_KEY}"`);
  }

  // Cycle check over in-template edges (core: refs point outside and cannot
  // close a loop here; compose checks the combined graph).
  const edges: DepEdge<string>[] = dependencies
    .filter((d) => !d.dependsOnRef.includes(":"))
    .map((d) => ({ task: d.taskKey, dependsOn: d.dependsOnRef, kind: d.kind }));
  const cycle = findCycle(taskKeys, edges);
  if (cycle) fail("dependencies", `cycle: ${cycle.join(" → ")}`);

  return {
    key: spec.key,
    name: spec.name.trim(),
    kind: spec.kind,
    trade: spec.trade?.trim() || null,
    description: spec.description?.trim() || null,
    serviceCategoryNames: [...(spec.serviceCategoryNames ?? [])],
    scopeToggles: toggles.map((t) => ({ ...t })),
    phases,
    tasks,
    dependencies,
  };
}
