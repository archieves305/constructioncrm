import type { RoleName, WorkflowPermitStatus, WorkflowRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { applyWorkflow, previewWorkflow, WorkflowApplyError, type ApplyInput } from "@/lib/workflows/apply";
import { compose } from "@/lib/workflows/compose";
import { loadPublishedVersion, toComposeModule } from "@/lib/workflows/load";
import { loadRoleContext, resolveAssignee, unassignedRoles } from "@/lib/workflows/roles";
import { auditCase } from "./audit";
import { ViolationError } from "./errors";
import { recordCaseEvent } from "./events";

/**
 * The case side of the workflow engine: the same apply/preview calls a job
 * makes, with the subject set to the case, plus the two things a case does
 * on top — it moves NEW → ACTIVE when its workflow is applied, and its
 * scope toggles are addressed by the (single) template's key.
 */

export type CaseWorkflowInput = {
  templateKey: string;
  permitStatus: WorkflowPermitStatus;
  /** The template's toggles, flat ({ hearing_required: true }); wrapped by template key for the engine. */
  scopeToggles: Record<string, boolean>;
  team?: Partial<Record<WorkflowRole, string | null>>;
  jurisdiction?: string | null;
  permitNotes?: string | null;
  permitDocumentFileId?: string | null;
};

export function toApplyInput(caseId: string, input: CaseWorkflowInput, actor: { id: string; role: RoleName }): ApplyInput {
  return {
    subject: { kind: "violation", violationCaseId: caseId },
    templateKeys: [input.templateKey],
    permitStatus: input.permitStatus,
    scopeToggles: { [input.templateKey]: input.scopeToggles },
    team: input.team,
    jurisdiction: input.jurisdiction,
    permit: input.permitStatus === "UNDETERMINED" ? undefined : { notes: input.permitNotes ?? null, documentFileId: input.permitDocumentFileId ?? null },
    actor,
  };
}

export async function previewCaseWorkflow(caseId: string, input: CaseWorkflowInput, actor: { id: string; role: RoleName }) {
  try {
    return await previewWorkflow(toApplyInput(caseId, input, actor));
  } catch (err) {
    if (err instanceof WorkflowApplyError) throw new ViolationError(err.status, err.message);
    throw err;
  }
}

export async function applyCaseWorkflow(caseId: string, input: CaseWorkflowInput, actor: { id: string; role: RoleName }) {
  let result;
  try {
    result = await applyWorkflow(toApplyInput(caseId, input, actor));
  } catch (err) {
    if (err instanceof WorkflowApplyError) throw new ViolationError(err.status, err.message);
    throw err;
  }
  const c = await prisma.codeViolationCase.findUnique({ where: { id: caseId }, select: { status: true } });
  if (c?.status === "NEW") {
    await prisma.codeViolationCase.update({ where: { id: caseId }, data: { status: "ACTIVE" } });
    await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "STATUS_CHANGED", fromValue: "NEW", toValue: "ACTIVE", body: "Workflow applied" });
  }
  await recordCaseEvent(prisma, { caseId, actorUserId: actor.id, type: "WORKFLOW_APPLIED", body: `${input.templateKey} — ${result.created} task${result.created === 1 ? "" : "s"} created`, toValue: input.templateKey });
  await auditCase({ actorUserId: actor.id, entityType: "CodeViolationCase", entityId: caseId, action: "violation_workflow_applied", after: { templateKey: input.templateKey, permitStatus: input.permitStatus, scopeToggles: input.scopeToggles, created: result.created, existing: result.existing } });
  return result;
}

/**
 * What a template would generate for a case that does not exist yet (the
 * intake review step). Roles resolve against the intake's case manager,
 * team picks and the company defaults; dates are not computed because the
 * case's creation date is not known until it is created.
 */
export async function previewTemplateForIntake(input: { templateKey: string; permitStatus: WorkflowPermitStatus; scopeToggles: Record<string, boolean>; caseManagerId: string | null; team?: Partial<Record<WorkflowRole, string | null>> }) {
  const v = await loadPublishedVersion(prisma, input.templateKey);
  if (!v) throw new ViolationError(400, `No published workflow template "${input.templateKey}"`);
  const mod = toComposeModule(v);
  if (mod.kind !== "VIOLATION") throw new ViolationError(400, `"${input.templateKey}" is not a violation template`);
  const plan = compose({ modules: [mod], permitStatus: input.permitStatus, scopeToggles: { [input.templateKey]: input.scopeToggles } });
  const base = await loadRoleContext(prisma, { teamOverride: input.team });
  const roleCtx = { ...base, caseManagerId: input.caseManagerId };
  const tasks = plan.tasks.map((t) => ({ key: t.key, phaseKey: t.phaseKey, title: t.title, role: t.role, assigneeId: resolveAssignee(t.role, roleCtx), blocking: t.blocking, initiallyActive: t.initiallyActive, dueAt: null as string | null, exists: false }));
  const rolesUsed = Array.from(new Set(plan.tasks.map((t) => t.role)));
  return {
    modules: plan.modules,
    phases: plan.phases.map((p) => ({ key: p.key, name: p.name, moduleName: p.moduleName, band: p.band, note: p.note, taskCount: p.taskKeys.length })),
    tasks,
    counts: {
      tasks: tasks.length,
      toCreate: tasks.length,
      existing: 0,
      phases: plan.phases.length,
      initiallyActive: tasks.filter((t) => t.initiallyActive).length,
      waiting: tasks.filter((t) => !t.initiallyActive).length,
      blocking: tasks.filter((t) => t.blocking).length,
    },
    estimatedBusinessDays: 0,
    rolesUsed,
    unassignedRoles: unassignedRoles(rolesUsed, roleCtx),
    potentialDuplicates: [] as { taskId: string; title: string; matchesKey: string }[],
    warnings: plan.warnings,
  };
}
