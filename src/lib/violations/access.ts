import type { Prisma, RoleName } from "@/generated/prisma/client";
import type { JobScope } from "@/lib/workflows/access";

/**
 * Who may do what to a code-violation case. Explicit role lists throughout
 * (the repo rule for anything consequential), with the case's relationships
 * — case manager, item assignee, task assignee, workflow team slot —
 * layered on for the own-only roles, the way a job's PM is on jobs.
 *
 * No new grant column: own-only roles only ever see cases they are on, and
 * the fine exposure is operational context for exactly those people.
 */

export type ViolationActor = { id: string; role: RoleName };

export type CaseScope = {
  caseManagerId: string | null;
  itemAssigneeIds: string[];
  taskAssigneeIds: string[];
  teamUserIds: string[];
};

const ADMIN_MANAGER: ReadonlySet<RoleName> = new Set<RoleName>(["ADMIN", "MANAGER"]);
const OFFICE: ReadonlySet<RoleName> = new Set<RoleName>(["ADMIN", "MANAGER", "OFFICE_STAFF"]);
const OWN_ONLY: ReadonlySet<RoleName> = new Set<RoleName>(["SALES_REP", "CREW_LEAD", "MARKETING"]);

export function isOnCase(user: ViolationActor, scope: CaseScope): boolean {
  return (
    scope.caseManagerId === user.id ||
    scope.itemAssigneeIds.includes(user.id) ||
    scope.taskAssigneeIds.includes(user.id) ||
    scope.teamUserIds.includes(user.id)
  );
}

/** Office roles and READ_ONLY see every case. */
export function canViewAllCases(role: RoleName): boolean {
  return OFFICE.has(role) || role === "READ_ONLY";
}

/** Where-fragment narrowing a case query to what this user may see. */
export function violationVisibilityFilter(user: ViolationActor): Prisma.CodeViolationCaseWhereInput {
  if (canViewAllCases(user.role)) return {};
  return {
    OR: [
      { caseManagerId: user.id },
      { items: { some: { assignedUserId: user.id } } },
      { tasks: { some: { assignedUserId: user.id } } },
      { workflow: { team: { some: { userId: user.id } } } },
    ],
  };
}

export function canViewCase(user: ViolationActor, scope: CaseScope): boolean {
  return canViewAllCases(user.role) || isOnCase(user, scope);
}

export function canCreateCase(role: RoleName): boolean {
  return OFFICE.has(role);
}

/** Edit the case header, items, notes-as-edits. Own-only roles: only on cases they are on. */
export function canEditCase(user: ViolationActor, scope: CaseScope): boolean {
  if (OFFICE.has(user.role)) return true;
  return OWN_ONLY.has(user.role) && isOnCase(user, scope);
}

/** Notes are the collaboration surface: anyone who can see the case, READ_ONLY included. */
export function canCommentOnCase(user: ViolationActor, scope: CaseScope): boolean {
  return canViewCase(user, scope);
}

export function canAssignCase(role: RoleName): boolean {
  return OFFICE.has(role);
}

export function canChangeDeadline(role: RoleName): boolean {
  return OFFICE.has(role);
}

export function canManageFines(role: RoleName): boolean {
  return OFFICE.has(role);
}

/** Override the system's fine estimate (with a reason). */
export function canOverrideFines(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

export function canRecordInspection(user: ViolationActor, scope: CaseScope): boolean {
  return canEditCase(user, scope);
}

export function canRecordHearing(user: ViolationActor, scope: CaseScope): boolean {
  return canEditCase(user, scope);
}

/** Record the agency's compliance confirmation — the closure precondition. */
export function canConfirmAgency(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

export function canCloseCase(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

export function canReopenCase(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

/** Close past the blockers (no agency confirmation, open items…) with a written reason. */
export function canOverrideClosure(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

export function canCancelCase(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

export function canExportCases(role: RoleName): boolean {
  return OFFICE.has(role) || role === "READ_ONLY";
}

/** Financial exposure: everyone who can see the case (see the header note). */
export function canViewFinancials(user: ViolationActor, scope: CaseScope): boolean {
  return canViewCase(user, scope);
}

export function canManageCategories(role: RoleName): boolean {
  return ADMIN_MANAGER.has(role);
}

/** Same list as the workflow report. */
export function canViewViolationReports(role: RoleName): boolean {
  return OFFICE.has(role) || role === "READ_ONLY";
}

/** Whether the dashboard shows every case or only the viewer's. */
export function violationDashboardScope(role: RoleName): "all" | "own" {
  return canViewAllCases(role) ? "all" : "own";
}

/**
 * The workflow permission helpers take a job's scope; a case's manager sits
 * in the project-manager position and its team slots are team slots.
 */
export function toJobScope(scope: CaseScope): JobScope {
  return { projectManagerId: scope.caseManagerId, teamUserIds: scope.teamUserIds, fieldUserIds: [] };
}

/** What the case page shows and hides, from one place. */
export function casePermissions(user: ViolationActor, scope: CaseScope) {
  return {
    canView: canViewCase(user, scope),
    canEdit: canEditCase(user, scope),
    canComment: canCommentOnCase(user, scope),
    canAssign: canAssignCase(user.role),
    canChangeDeadline: canChangeDeadline(user.role),
    canManageFines: canManageFines(user.role),
    canOverrideFines: canOverrideFines(user.role),
    canRecordInspection: canRecordInspection(user, scope),
    canRecordHearing: canRecordHearing(user, scope),
    canConfirmAgency: canConfirmAgency(user.role),
    canClose: canCloseCase(user.role),
    canReopen: canReopenCase(user.role),
    canOverrideClosure: canOverrideClosure(user.role),
    canCancel: canCancelCase(user.role),
    canViewFinancials: canViewFinancials(user, scope),
  };
}

export type CasePermissions = ReturnType<typeof casePermissions>;
