import type { WorkflowRole } from "@/generated/prisma/client";

/** Pure role list + labels, safe for client bundles (roles.ts pulls in Prisma). */
export const WORKFLOW_ROLES: readonly WorkflowRole[] = [
  "PROJECT_MANAGER",
  "SUPERINTENDENT",
  "PERMIT_COORDINATOR",
  "ESTIMATOR",
  "SALES_REP",
  "OFFICE_ADMIN",
  "PURCHASING",
  "ACCOUNTING",
  "QUALITY_CONTROL",
  // Appended, not inserted: `unassignedRoles` reports in this order.
  "CASE_MANAGER",
];

export const WORKFLOW_ROLE_LABEL: Record<WorkflowRole, string> = {
  PROJECT_MANAGER: "Project manager",
  SALES_REP: "Sales rep",
  SUPERINTENDENT: "Superintendent",
  PERMIT_COORDINATOR: "Permit coordinator",
  ESTIMATOR: "Estimator",
  OFFICE_ADMIN: "Office admin",
  PURCHASING: "Purchasing",
  ACCOUNTING: "Accounting",
  QUALITY_CONTROL: "Quality control",
  CASE_MANAGER: "Case manager",
};
