/**
 * What happened to cc-allocator's postings, in one shape for the intake's
 * replay and the status endpoint (CC Allocator → CRM Phase 1, step 3).
 * Pure: the caller loads the rows.
 */
export type AllocatorExpenseRow = {
  id: string;
  jobId: string;
  externalId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  holdReason: "TWIN" | "LABOR" | null;
  reviewNote: string | null;
  coveredByLaborPaymentId: string | null;
  updatedAt: Date;
};

export type AllocatorExpenseStatus = {
  externalId: string;
  expenseId: string;
  jobId: string;
  /** PENDING = held for a person; APPROVED = counted on the job; REJECTED = not counted. */
  status: AllocatorExpenseRow["status"];
  holdReason: AllocatorExpenseRow["holdReason"];
  /** The reviewer's note or the intake's hold note. */
  note: string | null;
  /** Rejected because a crew payment on a labor contract already carries this money. */
  coveredByCrewPayment: boolean;
  updatedAt: string;
};

export function allocatorExpenseStatus(row: AllocatorExpenseRow): AllocatorExpenseStatus {
  return {
    externalId: row.externalId ?? "",
    expenseId: row.id,
    jobId: row.jobId,
    status: row.status,
    holdReason: row.holdReason,
    note: row.reviewNote,
    coveredByCrewPayment: Boolean(row.coveredByLaborPaymentId),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const ALLOCATOR_STATUS_SELECT = {
  id: true,
  jobId: true,
  externalId: true,
  status: true,
  holdReason: true,
  reviewNote: true,
  coveredByLaborPaymentId: true,
  updatedAt: true,
} as const;

/** Most ids one status request may ask about. */
export const MAX_STATUS_IDS = 200;

/** Parse `?ids=a,b,c` (repeated params allowed): trimmed, de-duplicated, capped. */
export function parseStatusIds(values: readonly string[]): { ids: string[] } | { error: string } {
  const ids = [...new Set(values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
  if (!ids.length) return { error: "ids is required" };
  if (ids.length > MAX_STATUS_IDS) return { error: `at most ${MAX_STATUS_IDS} ids per request` };
  if (ids.some((id) => id.length > 200)) return { error: "id too long" };
  return { ids };
}

/**
 * A replay of an externalId the CRM already holds. The same job → the stored
 * status (a retry is safe); a different job → a conflict, because the CRM
 * never moves a posted cost silently (step 2 locks the job in cc-allocator).
 */
export function replayOutcome(existing: AllocatorExpenseRow, requestedJobId: string):
  | { kind: "replay"; body: AllocatorExpenseStatus & { alreadyExists: true } }
  | { kind: "conflict"; body: { error: "external_id_conflict"; message: string; existingJobId: string; expenseId: string } } {
  if (existing.jobId !== requestedJobId) {
    return {
      kind: "conflict",
      body: {
        error: "external_id_conflict",
        message: "The CRM already holds this charge on a different job. Move it in the CRM; it is not re-posted.",
        existingJobId: existing.jobId,
        expenseId: existing.id,
      },
    };
  }
  return { kind: "replay", body: { ...allocatorExpenseStatus(existing), alreadyExists: true } };
}
