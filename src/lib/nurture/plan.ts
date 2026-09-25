// The cadence, as pure functions over plain objects and an explicit `now`.
// No Prisma import: the runner loads rows, this decides, the runner writes.

import type { NurtureContentKind } from "@/generated/prisma/enums";
import { addLocalDays, hoursBetween, isInWindow, nextSendSlot, windowStartOn, type SendWindow } from "./time";

export type CadenceSettings = {
  followUpDays: number[];
  followUpEveryDaysAfter: number;
  nurtureDays: number[];
  nurtureEveryDaysAfter: number;
  nurtureMonthlyOffsetDays: number;
  minGapHours: number;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  timeZone: string;
  weekdaysOnly: boolean;
  personalTouchSkipDays: number;
  repPromptAfterDays: number;
  excludedStageIds: string[];
};

export function windowOf(s: CadenceSettings): SendWindow {
  return { startHour: s.sendWindowStartHour, endHour: s.sendWindowEndHour, timeZone: s.timeZone, weekdaysOnly: s.weekdaysOnly };
}

export type AnchorEventKind = "created" | "stage_change" | "estimate_sent" | "contract_sent" | "personal_touch";
export type AnchorEvent = { kind: AnchorEventKind; at: Date; detail?: string };

/** The latest event wins; ties go to the later kind in the list above (created loses to everything). */
export function anchorFor(events: AnchorEvent[]): { at: Date; reason: string } {
  const order: AnchorEventKind[] = ["created", "stage_change", "estimate_sent", "contract_sent", "personal_touch"];
  const best = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || order.indexOf(a.kind) - order.indexOf(b.kind)).at(-1);
  if (!best) throw new Error("anchorFor needs at least one event");
  return { at: best.at, reason: best.detail ? `${best.kind}:${best.detail}` : best.kind };
}

/** Days after the anchor for follow-up number `step` (0-based). Past the list: every N days. */
export function followUpOffsetDays(step: number, s: CadenceSettings): number {
  const days = s.followUpDays;
  if (days.length === 0) return (step + 1) * s.followUpEveryDaysAfter;
  if (step < days.length) return days[step]!;
  return days[days.length - 1]! + (step - days.length + 1) * s.followUpEveryDaysAfter;
}

/** Days after the nurture base for slot `slot` (0-based). Past the list: between the monthly follow-ups. */
export function nurtureOffsetDays(slot: number, s: CadenceSettings): number {
  const days = s.nurtureDays;
  if (slot < days.length) return days[slot]!;
  const lastFollowUp = s.followUpDays.length > 0 ? s.followUpDays[s.followUpDays.length - 1]! : 0;
  return lastFollowUp + s.nurtureMonthlyOffsetDays + (slot - days.length) * s.nurtureEveryDaysAfter;
}

export function computeFollowUpDue(anchorAt: Date, step: number, s: CadenceSettings): Date {
  const w = windowOf(s);
  return nextSendSlot(windowStartOn(addLocalDays(anchorAt, followUpOffsetDays(step, s), s.timeZone), w), w);
}

export function computeNurtureDue(baseAt: Date, slot: number, s: CadenceSettings): Date {
  const w = windowOf(s);
  return nextSendSlot(windowStartOn(addLocalDays(baseAt, nurtureOffsetDays(slot, s), s.timeZone), w), w);
}

/** Follow-up wins: a nurture due within the gap of a follow-up is pushed past it. */
export function resolveCollision(followUpDue: Date | null, nurtureDue: Date | null, s: CadenceSettings): { nextFollowUpAt: Date | null; nextNurtureAt: Date | null } {
  if (!followUpDue || !nurtureDue) return { nextFollowUpAt: followUpDue, nextNurtureAt: nurtureDue };
  if (hoursBetween(followUpDue, nurtureDue) >= s.minGapHours) return { nextFollowUpAt: followUpDue, nextNurtureAt: nurtureDue };
  const pushed = nextSendSlot(new Date(followUpDue.getTime() + s.minGapHours * 3_600_000), windowOf(s));
  return { nextFollowUpAt: followUpDue, nextNurtureAt: pushed };
}

export type PlannableState = {
  status: "ACTIVE" | "PAUSED" | "STOPPED";
  anchorAt: Date;
  followUpStep: number;
  nurtureBaseAt: Date;
  nurtureSlot: number;
  nextFollowUpAt: Date | null;
  nextNurtureAt: Date | null;
  lastAutoEmailAt: Date | null;
  lastPersonalTouchAt: Date | null;
  repPromptedAt: Date | null;
  stepsExhaustedNotifiedAt: Date | null;
  pausedByUserId: string | null;
  pausedReason: string | null;
  enrolledAt: Date;
};

export type PlannableLead = {
  email: string | null;
  emailOptedOut: boolean;
  stageId: string;
  stageIsClosed: boolean;
  stageIsWon: boolean;
  stageIsLost: boolean;
};

export type Decision =
  | { kind: "stop"; reason: "won" | "lost" | "closed" | "opted_out" | "no_email" }
  | { kind: "pause"; reason: "stage_excluded" }
  | { kind: "resume" }
  | { kind: "none"; reason: "inactive" | "outside_window" | "gap" | "not_due" }
  | { kind: "skip_follow_up"; reason: "recent_personal_touch"; step: number }
  | { kind: "follow_up"; step: number; due: Date }
  | { kind: "nurture"; slot: number; due: Date }
  | { kind: "nurture_exhausted" };

const DAY = 86_400_000;

/** What, if anything, this lead should get right now. One email per lead per tick by construction. */
export function decideAction(input: {
  lead: PlannableLead;
  state: PlannableState;
  now: Date;
  s: CadenceSettings;
  /** Latest automated email of any kind (ours or FollowUpRule's) — the gap check. */
  lastAutomatedEmailAt: Date | null;
  unsentNurtureCount: number;
}): Decision {
  const { lead, state, now, s } = input;
  if (state.status === "STOPPED") return { kind: "none", reason: "inactive" };
  if (lead.stageIsWon) return { kind: "stop", reason: "won" };
  if (lead.stageIsLost) return { kind: "stop", reason: "lost" };
  if (lead.stageIsClosed) return { kind: "stop", reason: "closed" };
  if (lead.emailOptedOut) return { kind: "stop", reason: "opted_out" };
  if (!lead.email?.trim()) return { kind: "stop", reason: "no_email" };

  const excluded = s.excludedStageIds.includes(lead.stageId);
  if (state.status === "PAUSED") {
    if (state.pausedByUserId) return { kind: "none", reason: "inactive" };
    if (state.pausedReason === "stage_excluded" && !excluded) return { kind: "resume" };
    return { kind: "none", reason: "inactive" };
  }
  if (excluded) return { kind: "pause", reason: "stage_excluded" };

  if (!isInWindow(now, windowOf(s))) return { kind: "none", reason: "outside_window" };
  if (input.lastAutomatedEmailAt && hoursBetween(input.lastAutomatedEmailAt, now) < s.minGapHours) return { kind: "none", reason: "gap" };

  if (state.nextFollowUpAt && state.nextFollowUpAt.getTime() <= now.getTime()) {
    if (state.lastPersonalTouchAt && now.getTime() - state.lastPersonalTouchAt.getTime() < s.personalTouchSkipDays * DAY) {
      return { kind: "skip_follow_up", reason: "recent_personal_touch", step: state.followUpStep };
    }
    return { kind: "follow_up", step: state.followUpStep, due: state.nextFollowUpAt };
  }
  if (state.nextNurtureAt && state.nextNurtureAt.getTime() <= now.getTime()) {
    if (input.unsentNurtureCount <= 0) return { kind: "nurture_exhausted" };
    return { kind: "nurture", slot: state.nurtureSlot, due: state.nextNurtureAt };
  }
  return { kind: "none", reason: "not_due" };
}

/** Quiet for `repPromptAfterDays` since the last touch / anchor / enrolment, and not already prompted since then. */
export function shouldPromptRep(state: PlannableState, now: Date, s: CadenceSettings): boolean {
  if (state.status !== "ACTIVE") return false;
  const since = Math.max(state.lastPersonalTouchAt?.getTime() ?? 0, state.anchorAt.getTime(), state.enrolledAt.getTime());
  if (now.getTime() - since < s.repPromptAfterDays * DAY) return false;
  if (state.repPromptedAt && state.repPromptedAt.getTime() >= since) return false;
  return true;
}

export function schedule(state: Pick<PlannableState, "anchorAt" | "followUpStep" | "nurtureBaseAt" | "nurtureSlot">, s: CadenceSettings, opts: { nurtureExhausted?: boolean } = {}) {
  const fu = computeFollowUpDue(state.anchorAt, state.followUpStep, s);
  const nu = opts.nurtureExhausted ? null : computeNurtureDue(state.nurtureBaseAt, state.nurtureSlot, s);
  return resolveCollision(fu, nu, s);
}

export function stateAfterSend(state: PlannableState, kind: NurtureContentKind, sentAt: Date, s: CadenceSettings, opts: { skipped?: boolean; nurtureExhausted?: boolean } = {}) {
  const next = kind === "FOLLOW_UP" ? { ...state, followUpStep: state.followUpStep + 1 } : { ...state, nurtureSlot: state.nurtureSlot + 1 };
  const sched = schedule(next, s, { nurtureExhausted: opts.nurtureExhausted });
  return {
    followUpStep: next.followUpStep,
    nurtureSlot: next.nurtureSlot,
    ...(kind === "FOLLOW_UP" && !opts.skipped ? { lastFollowUpAt: sentAt } : {}),
    ...(kind === "NURTURE" && !opts.skipped ? { lastNurtureAt: sentAt } : {}),
    ...(opts.skipped ? {} : { lastAutoEmailAt: sentAt }),
    nextFollowUpAt: sched.nextFollowUpAt,
    nextNurtureAt: sched.nextNurtureAt,
  };
}

/** Stage change / estimate / contract reset the step; a personal touch keeps it. Nurture is never touched. */
export function stateAfterReanchor(state: PlannableState, at: Date, reason: string, opts: { resetStep: boolean; nurtureExhausted?: boolean }, s: CadenceSettings) {
  const next = { ...state, anchorAt: at, followUpStep: opts.resetStep ? 0 : state.followUpStep };
  const sched = schedule(next, s, { nurtureExhausted: opts.nurtureExhausted });
  return {
    anchorAt: at,
    anchorReason: reason,
    followUpStep: next.followUpStep,
    nextFollowUpAt: sched.nextFollowUpAt,
    nextNurtureAt: sched.nextNurtureAt,
    ...(opts.resetStep ? { stepsExhaustedNotifiedAt: null } : {}),
  };
}

export function initialState(events: AnchorEvent[], now: Date, s: CadenceSettings, opts: { excludedStage?: boolean } = {}) {
  const anchor = anchorFor(events);
  const lastTouch = events.filter((e) => e.kind === "personal_touch").map((e) => e.at).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const base = { anchorAt: anchor.at, followUpStep: 0, nurtureBaseAt: now, nurtureSlot: 0 };
  const sched = schedule(base, s);
  return {
    status: opts.excludedStage ? ("PAUSED" as const) : ("ACTIVE" as const),
    pausedReason: opts.excludedStage ? "stage_excluded" : null,
    enrolledAt: now,
    anchorAt: anchor.at,
    anchorReason: anchor.reason,
    followUpStep: 0,
    nurtureBaseAt: now,
    nurtureSlot: 0,
    nextFollowUpAt: sched.nextFollowUpAt,
    nextNurtureAt: sched.nextNurtureAt,
    lastPersonalTouchAt: lastTouch,
  };
}
