import { APP_TIME_ZONE, dayKey } from "@/lib/time/zone";

/**
 * What the AI layer has cost, for Admin → AI usage. Pure: the loader in
 * `usage-load.ts` reads the rows, this rolls them up.
 */
export type UsageRow = {
  id: string;
  createdAt: Date;
  subjectType: string;
  subjectId: string;
  purpose: string;
  model: string;
  status: "OK" | "FAILED";
  costUsd: number;
  error: string | null;
};

export type MonthUsage = { month: string; calls: number; failed: number; costUsd: number };
export type PurposeUsage = { purpose: string; calls: number; failed: number; costUsd: number };

export type UsageSummary = {
  month: string;
  monthSpentUsd: number;
  months: MonthUsage[];
  byPurpose: PurposeUsage[];
  recentFailures: Pick<UsageRow, "id" | "createdAt" | "subjectType" | "subjectId" | "purpose" | "model" | "error">[];
};

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** "yyyy-MM" in office time. */
export function monthKey(d: Date, tz: string = APP_TIME_ZONE): string {
  return dayKey(d, tz).slice(0, 7);
}

/** The `count` month keys ending with the one `now` falls in, oldest first. */
export function lastMonthKeys(now: Date, count: number, tz: string = APP_TIME_ZONE): string[] {
  const [y, m] = monthKey(now, tz).split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    keys.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return keys;
}

export function summarizeUsage(rows: UsageRow[], now: Date, monthsBack = 6): UsageSummary {
  const keys = lastMonthKeys(now, monthsBack);
  const current = keys[keys.length - 1];
  const months = new Map(keys.map((k) => [k, { month: k, calls: 0, failed: 0, costUsd: 0 }]));
  const purposes = new Map<string, PurposeUsage>();

  for (const r of rows) {
    const k = monthKey(r.createdAt);
    const m = months.get(k);
    if (m) {
      m.calls++;
      if (r.status === "FAILED") m.failed++;
      m.costUsd += r.costUsd;
    }
    if (k !== current) continue;
    const p = purposes.get(r.purpose) ?? { purpose: r.purpose, calls: 0, failed: 0, costUsd: 0 };
    p.calls++;
    if (r.status === "FAILED") p.failed++;
    p.costUsd += r.costUsd;
    purposes.set(r.purpose, p);
  }

  const monthList = [...months.values()].map((m) => ({ ...m, costUsd: round(m.costUsd) }));
  return {
    month: current,
    monthSpentUsd: monthList[monthList.length - 1].costUsd,
    months: monthList,
    byPurpose: [...purposes.values()].map((p) => ({ ...p, costUsd: round(p.costUsd) })).sort((a, b) => b.costUsd - a.costUsd || a.purpose.localeCompare(b.purpose)),
    recentFailures: rows
      .filter((r) => r.status === "FAILED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20)
      .map(({ id, createdAt, subjectType, subjectId, purpose, model, error }) => ({ id, createdAt, subjectType, subjectId, purpose, model, error })),
  };
}
