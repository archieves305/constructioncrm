import { describe, expect, it } from "vitest";
import {
  anchorFor,
  computeFollowUpDue,
  computeNurtureDue,
  decideAction,
  followUpOffsetDays,
  initialState,
  nurtureOffsetDays,
  resolveCollision,
  shouldPromptRep,
  stateAfterReanchor,
  stateAfterSend,
  type CadenceSettings,
  type PlannableLead,
  type PlannableState,
} from "./plan";

const S: CadenceSettings = {
  followUpDays: [2, 7, 14, 30],
  followUpEveryDaysAfter: 30,
  nurtureDays: [4, 10, 21],
  nurtureEveryDaysAfter: 30,
  nurtureMonthlyOffsetDays: 15,
  minGapHours: 48,
  sendWindowStartHour: 8,
  sendWindowEndHour: 11,
  timeZone: "America/New_York",
  weekdaysOnly: true,
  personalTouchSkipDays: 3,
  repPromptAfterDays: 10,
  excludedStageIds: ["on-hold"],
};

// Anchor: Wed 2026-09-23 10:00 EDT.
const anchor = new Date("2026-09-23T14:00:00Z");
const inWindow = new Date("2026-10-01T13:30:00Z"); // Thu 09:30 EDT

const lead = (o: Partial<PlannableLead> = {}): PlannableLead => ({ email: "a@b.c", emailOptedOut: false, stageId: "new", stageIsClosed: false, stageIsWon: false, stageIsLost: false, ...o });
const state = (o: Partial<PlannableState> = {}): PlannableState => ({
  status: "ACTIVE",
  anchorAt: anchor,
  followUpStep: 0,
  nurtureBaseAt: anchor,
  nurtureSlot: 0,
  nextFollowUpAt: new Date("2026-09-25T12:00:00Z"),
  nextNurtureAt: new Date("2026-09-29T12:00:00Z"),
  lastAutoEmailAt: null,
  lastPersonalTouchAt: null,
  repPromptedAt: null,
  stepsExhaustedNotifiedAt: null,
  pausedByUserId: null,
  pausedReason: null,
  enrolledAt: anchor,
  ...o,
});

describe("offsets", () => {
  it("follow-ups: 2, 7, 14, 30, then every 30", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => followUpOffsetDays(i, S))).toEqual([2, 7, 14, 30, 60, 90]);
  });
  it("nurture: 4, 10, 21, then 45, 75 (between the monthly follow-ups)", () => {
    expect([0, 1, 2, 3, 4].map((i) => nurtureOffsetDays(i, S))).toEqual([4, 10, 21, 45, 75]);
  });
  it("due dates land on the window start of the offset day, rolling over weekends", () => {
    // anchor Wed 23 + 2 = Fri 25 08:00 EDT
    expect(computeFollowUpDue(anchor, 0, S).toISOString()).toBe("2026-09-25T12:00:00.000Z");
    // anchor + 4 = Sun 27 → Mon 28 08:00
    expect(computeNurtureDue(anchor, 0, S).toISOString()).toBe("2026-09-28T12:00:00.000Z");
    // anchor + 7 = Wed 30
    expect(computeFollowUpDue(anchor, 1, S).toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });
});

describe("anchorFor", () => {
  it("picks the latest event; ties go to the more specific kind", () => {
    const t = new Date("2026-09-20T12:00:00Z");
    expect(anchorFor([{ kind: "created", at: t }, { kind: "estimate_sent", at: t }]).reason).toBe("estimate_sent");
    expect(anchorFor([{ kind: "estimate_sent", at: t }, { kind: "personal_touch", at: new Date("2026-09-21T12:00:00Z"), detail: "call" }])).toEqual({ at: new Date("2026-09-21T12:00:00Z"), reason: "personal_touch:call" });
  });
});

describe("resolveCollision", () => {
  it("pushes a nurture inside the gap past the follow-up", () => {
    const fu = new Date("2026-09-30T12:00:00Z"); // Wed 08:00
    const nu = new Date("2026-10-01T12:00:00Z"); // Thu 08:00 — 24h later
    const r = resolveCollision(fu, nu, S);
    expect(r.nextFollowUpAt).toEqual(fu);
    expect(r.nextNurtureAt?.toISOString()).toBe("2026-10-02T12:00:00.000Z"); // Fri 08:00, exactly 48h
  });
  it("leaves a nurture outside the gap alone and tolerates nulls", () => {
    const fu = new Date("2026-09-30T12:00:00Z");
    const nu = new Date("2026-10-05T12:00:00Z");
    expect(resolveCollision(fu, nu, S)).toEqual({ nextFollowUpAt: fu, nextNurtureAt: nu });
    expect(resolveCollision(null, nu, S)).toEqual({ nextFollowUpAt: null, nextNurtureAt: nu });
  });
});

describe("decideAction", () => {
  const base = { now: inWindow, s: S, lastAutomatedEmailAt: null, unsentNurtureCount: 5 };
  it("stops on won / lost / opt-out / no email, in that order", () => {
    expect(decideAction({ ...base, lead: lead({ stageIsWon: true, stageIsClosed: true }), state: state() })).toEqual({ kind: "stop", reason: "won" });
    expect(decideAction({ ...base, lead: lead({ stageIsLost: true, stageIsClosed: true }), state: state() })).toEqual({ kind: "stop", reason: "lost" });
    expect(decideAction({ ...base, lead: lead({ emailOptedOut: true }), state: state() })).toEqual({ kind: "stop", reason: "opted_out" });
    expect(decideAction({ ...base, lead: lead({ email: " " }), state: state() })).toEqual({ kind: "stop", reason: "no_email" });
  });
  it("pauses on an excluded stage and resumes when it leaves, but never past a manual pause", () => {
    expect(decideAction({ ...base, lead: lead({ stageId: "on-hold" }), state: state() })).toEqual({ kind: "pause", reason: "stage_excluded" });
    expect(decideAction({ ...base, lead: lead(), state: state({ status: "PAUSED", pausedReason: "stage_excluded" }) })).toEqual({ kind: "resume" });
    expect(decideAction({ ...base, lead: lead(), state: state({ status: "PAUSED", pausedReason: "manual", pausedByUserId: "u1" }) })).toEqual({ kind: "none", reason: "inactive" });
    expect(decideAction({ ...base, lead: lead(), state: state({ status: "STOPPED" }) })).toEqual({ kind: "none", reason: "inactive" });
  });
  it("does nothing outside the window or inside the gap", () => {
    expect(decideAction({ ...base, now: new Date("2026-10-01T20:00:00Z"), lead: lead(), state: state() })).toEqual({ kind: "none", reason: "outside_window" });
    expect(decideAction({ ...base, lastAutomatedEmailAt: new Date("2026-09-30T13:00:00Z"), lead: lead(), state: state() })).toEqual({ kind: "none", reason: "gap" });
  });
  it("sends the follow-up when due, unless the rep touched the lead recently", () => {
    expect(decideAction({ ...base, lead: lead(), state: state() })).toEqual({ kind: "follow_up", step: 0, due: new Date("2026-09-25T12:00:00Z") });
    expect(decideAction({ ...base, lead: lead(), state: state({ lastPersonalTouchAt: new Date("2026-09-30T12:00:00Z") }) })).toEqual({ kind: "skip_follow_up", reason: "recent_personal_touch", step: 0 });
  });
  it("follow-up wins when both are due; nurture when only it is due; exhausted when the library is empty", () => {
    expect(decideAction({ ...base, lead: lead(), state: state() }).kind).toBe("follow_up");
    expect(decideAction({ ...base, lead: lead(), state: state({ nextFollowUpAt: new Date("2026-10-15T12:00:00Z") }) })).toEqual({ kind: "nurture", slot: 0, due: new Date("2026-09-29T12:00:00Z") });
    expect(decideAction({ ...base, unsentNurtureCount: 0, lead: lead(), state: state({ nextFollowUpAt: new Date("2026-10-15T12:00:00Z") }) })).toEqual({ kind: "nurture_exhausted" });
    expect(decideAction({ ...base, lead: lead(), state: state({ nextFollowUpAt: new Date("2026-10-15T12:00:00Z"), nextNurtureAt: new Date("2026-10-15T12:00:00Z") }) })).toEqual({ kind: "none", reason: "not_due" });
  });
});

describe("shouldPromptRep", () => {
  it("prompts after 10 quiet days, once, until a new touch", () => {
    const quiet = state({ enrolledAt: anchor, anchorAt: anchor });
    expect(shouldPromptRep(quiet, new Date("2026-10-02T12:00:00Z"), S)).toBe(false); // 9 days
    expect(shouldPromptRep(quiet, new Date("2026-10-04T12:00:00Z"), S)).toBe(true); // 11 days
    expect(shouldPromptRep(state({ repPromptedAt: new Date("2026-10-04T12:00:00Z") }), new Date("2026-10-20T12:00:00Z"), S)).toBe(false);
    expect(shouldPromptRep(state({ repPromptedAt: new Date("2026-10-04T12:00:00Z"), lastPersonalTouchAt: new Date("2026-10-06T12:00:00Z") }), new Date("2026-10-20T12:00:00Z"), S)).toBe(true);
  });
});

describe("state transitions", () => {
  it("after a follow-up: step+1, timestamps, next dates recomputed", () => {
    const sent = new Date("2026-09-25T13:00:00Z");
    const r = stateAfterSend(state(), "FOLLOW_UP", sent, S);
    expect(r.followUpStep).toBe(1);
    expect(r.lastFollowUpAt).toEqual(sent);
    expect(r.lastAutoEmailAt).toEqual(sent);
    expect(r.nextFollowUpAt?.toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });
  it("a skipped follow-up advances the step without a send timestamp", () => {
    const r = stateAfterSend(state(), "FOLLOW_UP", inWindow, S, { skipped: true });
    expect(r.followUpStep).toBe(1);
    expect(r.lastAutoEmailAt).toBeUndefined();
    expect(r.lastFollowUpAt).toBeUndefined();
  });
  it("re-anchor: estimate resets the step, a personal touch keeps it", () => {
    const at = new Date("2026-10-05T14:00:00Z"); // Mon 10:00 EDT
    const a = stateAfterReanchor(state({ followUpStep: 2, stepsExhaustedNotifiedAt: anchor }), at, "estimate_sent", { resetStep: true }, S);
    expect(a.followUpStep).toBe(0);
    expect(a.stepsExhaustedNotifiedAt).toBeNull();
    expect(a.nextFollowUpAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z"); // +2 = Wed
    const b = stateAfterReanchor(state({ followUpStep: 2 }), at, "personal_touch:call", { resetStep: false }, S);
    expect(b.followUpStep).toBe(2);
    expect(b.nextFollowUpAt?.toISOString()).toBe("2026-10-19T12:00:00.000Z"); // +14 = Mon
    expect(b.nextNurtureAt).toEqual(a.nextNurtureAt); // nurture untouched by either
  });
  it("initial state for a lead created on a Saturday schedules Monday+", () => {
    const sat = new Date("2026-09-26T16:00:00Z"); // Sat 12:00 EDT
    const r = initialState([{ kind: "created", at: sat }], sat, S);
    expect(r.status).toBe("ACTIVE");
    expect(r.nextFollowUpAt?.toISOString()).toBe("2026-09-28T12:00:00.000Z"); // +2 = Mon
    expect(r.nextNurtureAt?.toISOString()).toBe("2026-09-30T12:00:00.000Z"); // +4 = Wed
    expect(initialState([{ kind: "created", at: sat }], sat, S, { excludedStage: true }).status).toBe("PAUSED");
  });
});
