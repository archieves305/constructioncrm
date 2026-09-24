import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { CORE_MODULE_KEY, DETERMINE_PERMIT_TASK_KEY, isValidKey } from "./keys";
import { findCycle, type DepEdge } from "./dependencies";
import { loadPublishedVersion, readScopeToggles, VERSION_TREE_INCLUDE, type VersionTree } from "./load";
import { LEGAL_NO_PERMIT_WARNING } from "./templates/types";

/**
 * Validate a version tree as stored (the editor's "Validate" button and the
 * publish gate). Unlike `defineTemplate`, which throws on the first
 * problem, this collects every problem with a location so the editor can
 * offer "Go to task".
 */

export type ValidationIssue = {
  level: "error" | "warning";
  message: string;
  phaseKey?: string;
  taskKey?: string;
};

export type ValidationResult = { ok: boolean; issues: ValidationIssue[] };

export function validateTree(v: VersionTree, coreTaskKeys: ReadonlySet<string> | null): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (message: string, loc: { phaseKey?: string; taskKey?: string } = {}) => issues.push({ level: "error", message, ...loc });
  const warn = (message: string, loc: { phaseKey?: string; taskKey?: string } = {}) => issues.push({ level: "warning", message, ...loc });
  const isCore = v.template.kind === "CORE";
  const toggles = new Set(readScopeToggles(v.scopeToggles).map((t) => t.key));

  if (v.phases.length === 0) err("The template has no phases");
  const phaseKeys = new Set<string>();
  const phaseById = new Map(v.phases.map((p) => [p.id, p]));
  for (const p of v.phases) {
    if (!isValidKey(p.key)) err(`Phase key "${p.key}" must be lowercase letters, digits and underscores`, { phaseKey: p.key });
    if (phaseKeys.has(p.key)) err(`Duplicate phase key "${p.key}"`, { phaseKey: p.key });
    phaseKeys.add(p.key);
    if (!p.name.trim()) err("A phase has no name", { phaseKey: p.key });
    if (p.conditionPermit === "NOT_REQUIRED" && !p.note?.trim()) err("A No-Permit phase must carry the legal warning as its note", { phaseKey: p.key });
    if (p.conditionPermit === "NOT_REQUIRED" && p.note && p.note.trim() !== LEGAL_NO_PERMIT_WARNING) warn("The No-Permit note differs from the standard legal warning", { phaseKey: p.key });
    if (!v.tasks.some((t) => t.phaseId === p.id)) err(`Phase "${p.name}" has no steps`, { phaseKey: p.key });
  }

  const taskKeys = new Set<string>();
  for (const t of v.tasks) {
    const phase = phaseById.get(t.phaseId);
    const loc = { phaseKey: phase?.key, taskKey: t.key };
    if (!isValidKey(t.key)) err(`Step key "${t.key}" must be lowercase letters, digits and underscores`, loc);
    if (taskKeys.has(t.key)) err(`Duplicate step key "${t.key}"`, loc);
    taskKeys.add(t.key);
    if (!t.title.trim()) err("A step has no title", loc);
    if (!phase) err(`Step "${t.title}" points at a phase that no longer exists`, loc);
    if (t.dueOffsetBusinessDays < 0 && t.anchor !== "TARGET_START") err(`"${t.title}": a negative offset only makes sense from the target start date`, loc);
    for (const k of [...t.conditionAnyOf, ...t.conditionAllOf]) if (!toggles.has(k)) err(`"${t.title}" uses unknown scope toggle "${k}"`, loc);
    if (t.conditionPermit && phase?.conditionPermit && t.conditionPermit !== phase.conditionPermit) err(`"${t.title}" contradicts its phase's permit branch`, loc);
    if (t.overridesCoreKey) {
      if (isCore) err(`"${t.title}": only a trade step may override a Core step`, loc);
      else if (t.overridesCoreKey === DETERMINE_PERMIT_TASK_KEY) err(`"${t.title}": "Determine permit requirement" is never overridden`, loc);
      else if (coreTaskKeys && !coreTaskKeys.has(t.overridesCoreKey)) err(`"${t.title}" overrides Core step "${t.overridesCoreKey}", which does not exist`, loc);
    }
    if (Array.isArray(t.checklist)) {
      for (const item of t.checklist as { label?: string; condition?: { anyOf?: string[]; allOf?: string[] } }[]) {
        if (!item?.label?.trim()) err(`"${t.title}" has an empty checklist line`, loc);
        for (const k of [...(item?.condition?.anyOf ?? []), ...(item?.condition?.allOf ?? [])]) if (!toggles.has(k)) err(`"${t.title}" checklist uses unknown toggle "${k}"`, loc);
      }
    }
  }
  if (isCore && !taskKeys.has(DETERMINE_PERMIT_TASK_KEY)) err(`The Core template must contain a step with key "${DETERMINE_PERMIT_TASK_KEY}"`);

  const edges: DepEdge<string>[] = [];
  for (const d of v.dependencies) {
    const owner = v.tasks.find((t) => t.key === d.taskKey);
    const loc = { phaseKey: owner ? phaseById.get(owner.phaseId)?.key : undefined, taskKey: d.taskKey };
    if (!taskKeys.has(d.taskKey)) {
      err(`A dependency belongs to unknown step "${d.taskKey}"`, loc);
      continue;
    }
    if (d.dependsOnRef.startsWith(`${CORE_MODULE_KEY}:`)) {
      if (isCore) err(`"${d.taskKey}" refers to core: inside the Core template — use the bare key`, loc);
      else if (coreTaskKeys && !coreTaskKeys.has(d.dependsOnRef.slice(CORE_MODULE_KEY.length + 1))) err(`"${d.taskKey}" waits on Core step "${d.dependsOnRef}", which does not exist`, loc);
      continue;
    }
    if (d.dependsOnRef.includes(":")) {
      err(`"${d.taskKey}" waits on "${d.dependsOnRef}" — only core: references may cross templates`, loc);
      continue;
    }
    if (!taskKeys.has(d.dependsOnRef)) {
      err(`"${d.taskKey}" waits on unknown step "${d.dependsOnRef}"`, loc);
      continue;
    }
    if (d.dependsOnRef === d.taskKey) {
      err(`"${d.taskKey}" waits on itself`, loc);
      continue;
    }
    edges.push({ task: d.taskKey, dependsOn: d.dependsOnRef, kind: d.kind });
  }
  const cycle = findCycle(taskKeys, edges);
  if (cycle) err(`Dependency cycle: ${cycle.join(" → ")}`, { taskKey: cycle[0] });

  return { ok: !issues.some((i) => i.level === "error"), issues };
}

export async function validateVersion(versionId: string): Promise<ValidationResult> {
  const v = await prisma.workflowTemplateVersion.findUnique({ where: { id: versionId }, include: VERSION_TREE_INCLUDE });
  if (!v) return { ok: false, issues: [{ level: "error", message: "Version not found" }] };
  let coreKeys: Set<string> | null = null;
  if (v.template.kind !== "CORE") {
    const core = await loadPublishedVersion(prisma, CORE_MODULE_KEY);
    coreKeys = core ? new Set(core.tasks.map((t) => t.key)) : null;
  }
  return validateTree(v, coreKeys);
}

export type { Prisma };
