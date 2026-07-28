import type { PayType, RoleName } from "@/generated/prisma/client";
import { canReadPersonnel, canSeeLaborCosts } from "./permissions";
import { fromDbDate } from "./dates";
import { resolveWorkerScope, type WorkerScope } from "./scope";

// Single choke point that shapes personnel records per viewer before they
// leave the API. Sensitive material is OMITTED server-side (never sent and
// hidden client-side): SSN ciphertext never leaves the server at all; rates
// only go to cost-visible roles; CREW_LEAD/READ_ONLY get roster fields only.

type PersonnelRecord = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  trade: string | null;
  title: string | null;
  hourlyRate: unknown;
  employmentType: string;
  payType: string;
  workDescription: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  entityName: string | null;
  crewId: string | null;
  userId: string | null;
  notes: string | null;
  isActive: boolean;
  ssnLast4: string | null;
  createdAt: Date;
  updatedAt: Date;
  crew?: { id: string; name: string } | null;
  documents?: unknown[];
};

export function serializePersonnel(
  record: PersonnelRecord,
  viewerRole: RoleName,
) {
  if (!canReadPersonnel(viewerRole)) return null;

  const rosterView = viewerRole === "CREW_LEAD" || viewerRole === "READ_ONLY";
  if (rosterView) {
    return {
      id: record.id,
      firstName: record.firstName,
      lastName: record.lastName,
      trade: record.trade,
      title: record.title,
      employmentType: record.employmentType,
      // Pay BASIS and job scope, not pay AMOUNT — a crew lead needs to know
      // who is on piecework and what they're there to do. Rates stay out.
      payType: record.payType,
      workDescription: record.workDescription,
      status: record.status,
      crewId: record.crewId,
      crew: record.crew ?? null,
      isActive: record.isActive,
    };
  }

  // Destructure the record so ciphertext material can never ride along on a
  // spread — Prisma rows include every scalar column.
  const {
    hourlyRate,
    ssnLast4,
    ssnCiphertext: _ssnCiphertext,
    ssnKeyVersion: _ssnKeyVersion,
    ...base
  } = record as PersonnelRecord & {
    ssnCiphertext?: string | null;
    ssnKeyVersion?: number | null;
  };

  return {
    ...base,
    ssnLast4,
    hasSsn: Boolean(ssnLast4),
    ...(canSeeLaborCosts(viewerRole) ? { hourlyRate } : {}),
  };
}

// ── Labor entries & daily logs ──────────────────────────────────────────────

type LaborEntryRecord = {
  id: string;
  dailyLogId: string;
  jobId: string;
  workDate: Date;
  personnelId: string;
  trade: string | null;
  jobAreaId: string | null;
  workArea: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number;
  totalHours: unknown;
  regularHours: unknown;
  otHours: unknown;
  regularRate: unknown;
  otRate: unknown;
  totalCost: unknown;
  costCodeId: string | null;
  phase: string | null;
  budgetLineId: string | null;
  isAbsent: boolean;
  isLate: boolean;
  leftEarly: boolean;
  absenceReason: string | null;
  notes: string | null;
  personnel?: {
    id: string;
    firstName: string;
    lastName: string;
    trade: string | null;
    payType?: PayType;
    workDescription?: string | null;
  } | null;
};

/** Per-job pay/scope overrides, keyed by personnelId. */
export type ScopeOverrides = Map<
  string,
  { payType: PayType | null; workDescription: string | null }
>;

/**
 * Shape a labor entry for the viewer. Rates and costs are OMITTED (not
 * nulled) for roles without cost visibility — the client renders whatever
 * shape it receives.
 */
export function serializeLaborEntry(
  entry: LaborEntryRecord,
  viewerRole: RoleName,
  overrides?: ScopeOverrides,
) {
  const { regularRate, otRate, totalCost, workDate, ...base } = entry;
  // Pay basis + scope of work as they apply ON THIS JOB. Attached to the
  // entry so the crew sheet never re-derives the profile/override fallback.
  const scope: WorkerScope | null = entry.personnel?.payType
    ? resolveWorkerScope(
        {
          payType: entry.personnel.payType,
          workDescription: entry.personnel.workDescription ?? null,
        },
        overrides?.get(entry.personnelId) ?? null,
      )
    : null;
  return {
    ...base,
    scope,
    workDate: fromDbDate(workDate),
    totalHours: Number(entry.totalHours),
    regularHours: Number(entry.regularHours),
    otHours: Number(entry.otHours),
    ...(canSeeLaborCosts(viewerRole)
      ? {
          regularRate: Number(regularRate),
          otRate: Number(otRate),
          totalCost: Number(totalCost),
        }
      : {}),
  };
}

type DailyLogRecord = {
  id: string;
  jobId: string;
  logDate: Date;
  status: string;
  updatedAt: Date;
  laborEntries?: LaborEntryRecord[];
  [key: string]: unknown;
};

/** Shape a daily log (+ entries and roll-up totals) for the viewer. */
export function serializeDailyLog(log: DailyLogRecord, viewerRole: RoleName) {
  // `job` carries the per-job scope overrides for the merge below; it is
  // destructured out so the raw override rows never reach the client.
  const { laborEntries, logDate, job, ...base } = log as DailyLogRecord & {
    job?: {
      personnelScopes?: {
        personnelId: string;
        payType: PayType | null;
        workDescription: string | null;
      }[];
    } | null;
  };
  const overrides: ScopeOverrides = new Map(
    (job?.personnelScopes ?? []).map((s) => [
      s.personnelId,
      { payType: s.payType, workDescription: s.workDescription },
    ]),
  );
  const entries = (laborEntries ?? []).map((e) =>
    serializeLaborEntry(e, viewerRole, overrides),
  );
  const present = entries.filter((e) => !e.isAbsent);
  const totals: Record<string, number> = {
    workersOnsite: new Set(present.map((e) => e.personnelId)).size,
    totalHours: round2(present.reduce((s, e) => s + e.totalHours, 0)),
    regularHours: round2(present.reduce((s, e) => s + e.regularHours, 0)),
    otHours: round2(present.reduce((s, e) => s + e.otHours, 0)),
  };
  if (canSeeLaborCosts(viewerRole)) {
    totals.totalCost = round2(
      present.reduce((s, e) => s + ((e as { totalCost?: number }).totalCost ?? 0), 0),
    );
  }
  return {
    ...base,
    logDate: fromDbDate(logDate),
    entries,
    totals,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
