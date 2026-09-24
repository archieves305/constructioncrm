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
