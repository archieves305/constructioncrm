import type { PayType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

// A worker's pay basis and work description have a profile default and an
// optional per-job override (JobPersonnelScope). Every reader goes through
// here so the fallback rule stays in one place.
//
// Columns fall through INDEPENDENTLY: a job row that sets only a description
// keeps the profile's pay type. A row exists only where something differs,
// so "no row" and "row of all nulls" resolve identically.

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  CONTRACT: "Contract",
  HOURLY: "Hourly",
  PIECEWORK: "Piecework",
};

/** Piecework is paid by output, so hours × rate is not what the worker earns. */
export function isHoursBasedPay(payType: PayType): boolean {
  return payType === "HOURLY";
}

export type WorkerScope = {
  payType: PayType;
  workDescription: string | null;
  /** True when this job overrides the profile — drives the "job override" chip. */
  isOverridden: boolean;
};

type ProfileDefaults = {
  payType: PayType;
  workDescription: string | null;
};

type ScopeOverride = {
  payType: PayType | null;
  workDescription: string | null;
} | null;

export function resolveWorkerScope(
  profile: ProfileDefaults,
  override: ScopeOverride,
): WorkerScope {
  const payType = override?.payType ?? profile.payType;
  const workDescription = override?.workDescription ?? profile.workDescription;
  return {
    payType,
    workDescription,
    isOverridden: Boolean(
      override && (override.payType !== null || override.workDescription !== null),
    ),
  };
}

/**
 * Resolved scope for every worker on a job, keyed by personnelId. Callers
 * pass the personnel ids they care about (the day's labor sheet, usually);
 * ids with no override still get a row built from their profile.
 */
export async function resolveJobWorkerScopes(
  jobId: string,
  personnelIds: string[],
): Promise<Map<string, WorkerScope>> {
  const ids = [...new Set(personnelIds)];
  if (ids.length === 0) return new Map();

  const [people, overrides] = await Promise.all([
    prisma.personnel.findMany({
      where: { id: { in: ids } },
      select: { id: true, payType: true, workDescription: true },
    }),
    prisma.jobPersonnelScope.findMany({
      where: { jobId, personnelId: { in: ids } },
      select: { personnelId: true, payType: true, workDescription: true },
    }),
  ]);

  const overrideById = new Map(overrides.map((o) => [o.personnelId, o]));
  return new Map(
    people.map((p) => [p.id, resolveWorkerScope(p, overrideById.get(p.id) ?? null)]),
  );
}
