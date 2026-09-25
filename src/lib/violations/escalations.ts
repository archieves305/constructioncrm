import { daysRemaining } from "./dates";

/**
 * Overdue compliance deadlines climb a chain: the case manager, then every
 * MANAGER, then every ADMIN. Pure planning here; the ledger is the reminder
 * log (`offsetKey = "esc:<level>"`) and the runner lives in reminder-run.ts.
 */

export type EscalationCase = {
  id: string;
  caseNumber: string;
  leadId: string;
  caseManagerId: string | null;
  currentDeadline: Date;
  /** Highest "esc:<n>" already logged for this deadline. */
  currentLevel: number;
};

export type CaseEscalationPlan = { caseId: string; fromLevel: number; toLevel: number; daysOverdue: number };

export function parseEscalationDays(raw: string): number[] {
  return [...new Set(raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0))].sort((a, b) => a - b);
}

/** Which cases crossed a new threshold today. `toLevel` = thresholds passed. */
export function planCaseEscalations(cases: EscalationCase[], thresholds: number[], now: Date): CaseEscalationPlan[] {
  const out: CaseEscalationPlan[] = [];
  for (const c of cases) {
    const overdue = -daysRemaining(c.currentDeadline, now);
    if (overdue <= 0) continue;
    const toLevel = thresholds.filter((d) => overdue >= d).length;
    if (toLevel > c.currentLevel) out.push({ caseId: c.id, fromLevel: c.currentLevel, toLevel, daysOverdue: overdue });
  }
  return out;
}

export type EscalationAudienceMember = { userId: string; reason: "case_manager" | "manager" | "admin" };

/**
 * Level 1 = the case manager (or the managers when there is none), level 2
 * adds every MANAGER, level 3 adds every ADMIN. Cumulative, so a manager
 * who is also the case manager appears once.
 */
export function caseEscalationAudience(plan: CaseEscalationPlan, c: { caseManagerId: string | null }, managers: string[], admins: string[]): EscalationAudienceMember[] {
  const out = new Map<string, EscalationAudienceMember>();
  if (c.caseManagerId) out.set(c.caseManagerId, { userId: c.caseManagerId, reason: "case_manager" });
  if (plan.toLevel >= 2 || !c.caseManagerId) for (const m of managers) if (!out.has(m)) out.set(m, { userId: m, reason: "manager" });
  if (plan.toLevel >= 3) for (const a of admins) if (!out.has(a)) out.set(a, { userId: a, reason: "admin" });
  return [...out.values()];
}
