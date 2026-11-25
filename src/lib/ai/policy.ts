import { APP_TIME_ZONE, dayKey, startOfDayIn } from "@/lib/time/zone";

/**
 * The rules a call is held to before it is made. Pure.
 *
 * Two caps: one per subject (a permit, a correction notice…) so a runaway
 * retry on one document cannot spend the month, and one per calendar month
 * (office time) across the whole app.
 */
export type CapState = { spentSubject: number; spentMonth: number; maxSubject: number; maxMonth: number };
export type CapProblem = { scope: "subject" | "month"; spent: number; max: number; pool?: MonthlyPool | null };

/**
 * Subject types with a monthly allowance of their own. Their calls count only
 * against their pool, and the app-wide month leaves them out.
 */
export type MonthlyPool = { subjectType: string; envName: string; label: string };
export const MONTHLY_POOLS: readonly MonthlyPool[] = [
  { subjectType: "inspection", envName: "AI_INSPECTOR_MONTHLY_MAX_USD", label: "Inspection AI spending" },
];
export const POOLED_SUBJECT_TYPES: readonly string[] = MONTHLY_POOLS.map((p) => p.subjectType);

export function poolFor(subjectType: string): MonthlyPool | null {
  return MONTHLY_POOLS.find((p) => p.subjectType === subjectType) ?? null;
}

export function capProblem(s: CapState): CapProblem | null {
  if (s.spentMonth >= s.maxMonth) return { scope: "month", spent: s.spentMonth, max: s.maxMonth };
  if (s.spentSubject >= s.maxSubject) return { scope: "subject", spent: s.spentSubject, max: s.maxSubject };
  return null;
}

export function capMessage(p: CapProblem): string {
  if (p.scope === "month" && p.pool) return `${p.pool.label} this month has reached $${p.spent.toFixed(2)} of the $${p.max.toFixed(0)} limit (${p.pool.envName})`;
  return p.scope === "month"
    ? `AI spending this month has reached $${p.spent.toFixed(2)} of the $${p.max.toFixed(0)} limit (AI_MONTHLY_MAX_USD)`
    : `This record has used $${p.spent.toFixed(2)} of its $${p.max.toFixed(0)} AI allowance (AI_MAX_USD_PER_SUBJECT)`;
}

/** The first instant of the office-time month that `now` falls in. */
export function monthStart(now: Date, tz: string = APP_TIME_ZONE): Date {
  return startOfDayIn(`${dayKey(now, tz).slice(0, 7)}-01`, tz);
}

/**
 * Server-side refusal fallback (`fallbacks: "default"`) is offered for the
 * Opus, Sonnet and Fable lines on the Claude API; Haiku has none, and sending
 * the parameter there would be refused.
 */
export function supportsServerFallback(model: string): boolean {
  return /^claude-(opus|sonnet|fable)-/.test(model);
}
