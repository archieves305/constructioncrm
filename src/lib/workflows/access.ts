import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may do what to a job's workflow. Explicit role lists throughout — the
 * repo rule for anything consequential — with the job's project manager
 * layered on as a relationship, not a role.
 */

export type WorkflowActor = { id: string; role: RoleName };

export type JobScope = {
  projectManagerId: string | null;
  /** Users holding a team slot on the workflow. */
  teamUserIds?: string[];
  /** CREW_LEADs field-assigned to the job. */
  fieldUserIds?: string[];
};

const ADMIN_MANAGER: ReadonlySet<RoleName> = new Set<RoleName>(["ADMIN", "MANAGER"]);
const OFFICE: ReadonlySet<RoleName> = new Set<RoleName>(["ADMIN", "MANAGER", "OFFICE_STAFF"]);

function isPm(user: WorkflowActor, job: JobScope): boolean {
  return job.projectManagerId !== null && job.projectManagerId === user.id;
}

/** Browse the template library. */
export function canViewTemplates(role: RoleName): boolean {
  return OFFICE.has(role);
}

/** Create, edit, publish or archive templates (Stage 2 editor). */
export function canManageTemplates(role: RoleName): boolean {
  return role === "ADMIN";
}

/** Apply a workflow, add or remove a trade, reconcile, upgrade a version. */
export function canApplyWorkflow(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

/** Set the permit status / determination. */
export function canSetPermitStatus(user: WorkflowActor, job: JobScope): boolean {
  return ADMIN_MANAGER.has(user.role) || isPm(user, job);
}

/** Edit team slots, add a manual task to a phase, skip a NON-blocking step, complete on behalf. */
export function canCoordinateWorkflow(user: WorkflowActor, job: JobScope): boolean {
  return OFFICE.has(user.role) || isPm(user, job);
}

/** Skip or override a BLOCKING gate, or complete past missing evidence. Never the PM by relationship. */
export function canOverrideBlockingGate(role: RoleName | null): boolean {
  return role !== null && ADMIN_MANAGER.has(role);
}

/** Record an inspection result on a step: office roles, the PM, the assignee, or a crew lead on the job. */
export function canRecordInspection(user: WorkflowActor, job: JobScope, task: { assignedUserId: string | null }): boolean {
  if (OFFICE.has(user.role) || isPm(user, job)) return true;
  if (task.assignedUserId === user.id) return true;
  return user.role === "CREW_LEAD" && (job.fieldUserIds ?? []).includes(user.id);
}

/** Add or remove a manual dependency between two steps on the same job. */
export function canEditDependencies(user: WorkflowActor, job: JobScope): boolean {
  return canCoordinateWorkflow(user, job);
}

/** The workflow report and CSV: office roles plus read-only. Never the own-only roles. */
export function canViewWorkflowReports(role: RoleName): boolean {
  return OFFICE.has(role) || role === "READ_ONLY";
}

/**
 * Which jobs the dashboard workflow-health widget may count for this user:
 * office and read-only roles see the company; everyone else sees the jobs
 * they sell or manage.
 */
export function workflowHealthScope(user: WorkflowActor): "all" | "own" {
  return canViewWorkflowReports(user.role) ? "all" : "own";
}

/** Read/write the company-wide role defaults. */
export function canEditRoleDefaults(role: RoleName): boolean {
  return role === "ADMIN";
}
export function canViewRoleDefaults(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

/**
 * Whether an own-only role (SALES_REP, CREW_LEAD, MARKETING) is on this
 * job's team in any capacity — PM, team slot or field assignment — and so
 * may see the whole workflow rather than just their own steps.
 */
export function isOnJobTeam(user: WorkflowActor, job: JobScope): boolean {
  return (
    isPm(user, job) ||
    (job.teamUserIds ?? []).includes(user.id) ||
    (job.fieldUserIds ?? []).includes(user.id)
  );
}
