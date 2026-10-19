import type { RoleName } from "@/generated/prisma/client";

/**
 * Who may change what a job is worth or what has been paid.
 *
 * Payments, lump-sum invoices, crew labor contracts and their payments,
 * budgets and the job's own pricing fields had no role check: any signed-in
 * user — READ_ONLY, MARKETING, a crew lead with the URL — could change a
 * contract amount or delete a payment. This is the one list those routes use.
 *
 * Explicit role lists, never `hasMinRole`: the hierarchy ranks SALES_REP above
 * OFFICE_STAFF (Accounting). Same list as expense approval
 * (`lib/expenses/permissions.ts`) and progress billing. Pure and client-safe,
 * so a panel can hide what the server would refuse.
 */
const MONEY_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF"];

export function canManageJobMoney(role: RoleName | null | undefined): boolean {
  return Boolean(role) && MONEY_ROLES.includes(role as RoleName);
}

/** Company-wide A/R, profitability and progress positions (Collections). */
const FINANCIAL_REPORT_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"];

export function canViewCompanyFinancials(role: RoleName | null | undefined): boolean {
  return Boolean(role) && FINANCIAL_REPORT_ROLES.includes(role as RoleName);
}

/** The job's non-money fields: title, next action, team, start date, jurisdiction. */
const JOB_EDIT_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "SALES_REP"];

export function canEditJobRecord(role: RoleName | null | undefined): boolean {
  return Boolean(role) && JOB_EDIT_ROLES.includes(role as RoleName);
}

/** Fields of `PATCH /api/jobs/[id]` that move money; the rest are the job record. */
export const JOB_MONEY_FIELDS = [
  "contractAmount",
  "depositRequired",
  "jobType",
  "laborCost",
  "marginType",
  "marginValue",
] as const;

export function touchesJobMoney(body: Record<string, unknown>): boolean {
  return JOB_MONEY_FIELDS.some((f) => body[f] !== undefined);
}

/**
 * How much of a job's money a viewer may see (ruled 2026-10-19).
 *
 * - "full": price, payments, cost, profit and crew pay. The office roles and
 *   READ_ONLY, and the job's own project manager whatever their role.
 * - "price": what the customer pays and has paid (contract, invoices,
 *   payments, change orders), never cost, profit or crew pay. A sales rep.
 * - "none": no money at all. A crew lead or marketing.
 */
export type JobMoneyView = "full" | "price" | "none";

const MONEY_VIEW_FULL_ROLES: readonly RoleName[] = ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY"];

export function jobMoneyView(viewer: { id: string; role: RoleName | string }, job: { projectManagerId?: string | null }): JobMoneyView {
  if (MONEY_VIEW_FULL_ROLES.includes(viewer.role as RoleName)) return "full";
  if (job.projectManagerId && job.projectManagerId === viewer.id) return "full";
  if (viewer.role === "SALES_REP") return "price";
  return "none";
}

export const COST_HIDDEN_MESSAGE = "A job's costs, profit and crew pay are shown to the office and the job's project manager.";
export const MONEY_HIDDEN_MESSAGE = "Your role does not see a job's money.";

export const MONEY_DENIED_MESSAGE =
  "Only an admin, a manager or office staff can change payments, invoices, labor contracts, budgets or a job's pricing.";
