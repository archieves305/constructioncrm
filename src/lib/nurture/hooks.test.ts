import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, autoTasks } = vi.hoisted(() => ({
  db: {
    leadNurtureState: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    nurtureSettings: { upsert: vi.fn() },
    lead: { findUnique: vi.fn() },
  },
  autoTasks: { closeAutoTask: vi.fn(), sourceKeyFor: vi.fn((s: { leadId: string }) => `lead:NURTURE_TOUCH:${s.leadId}`) },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/tasks/auto-tasks", () => autoTasks);
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), info: vi.fn() } }));

const { onLeadStageChanged, onPersonalTouch, onEstimateSent, setNurtureStatus } = await import("./hooks");

const settings = {
  id: "default",
  enabled: true,
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
const anchor = new Date("2026-09-23T14:00:00Z");
const state = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  leadId: "l1",
  status: "ACTIVE",
  anchorAt: anchor,
  followUpStep: 2,
  nurtureBaseAt: anchor,
  nurtureSlot: 1,
  nextFollowUpAt: null,
  nextNurtureAt: null,
  lastAutoEmailAt: null,
  lastPersonalTouchAt: null,
  repPromptedAt: null,
  stepsExhaustedNotifiedAt: null,
  nurtureExhaustedAt: null,
  pausedByUserId: null,
  pausedReason: null,
  enrolledAt: anchor,
  ...o,
});

beforeEach(() => {
  for (const g of Object.values(db)) for (const fn of Object.values(g)) (fn as ReturnType<typeof vi.fn>).mockReset();
  db.nurtureSettings.upsert.mockResolvedValue(settings);
  db.leadNurtureState.updateMany.mockResolvedValue({ count: 1 });
  db.leadNurtureState.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...state(), ...args.data }));
});

describe("onLeadStageChanged", () => {
  it("Won stops the cadence and cancels the prompt task", async () => {
    await onLeadStageChanged("l1", { id: "won", name: "Won", isClosed: true, isWon: true, isLost: false });
    expect(db.leadNurtureState.updateMany.mock.calls[0][0]).toMatchObject({ where: { leadId: "l1" }, data: { status: "STOPPED", stoppedReason: "won", nextFollowUpAt: null } });
    expect(autoTasks.closeAutoTask).toHaveBeenCalledWith("lead:NURTURE_TOUCH:l1", expect.objectContaining({ outcome: "CANCELLED" }));
  });
  it("an open stage re-anchors with the step reset", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state());
    const at = new Date("2026-10-05T14:00:00Z");
    await onLeadStageChanged("l1", { id: "neg", name: "Negotiation", isClosed: false, isWon: false, isLost: false }, at);
    const data = db.leadNurtureState.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ anchorAt: at, anchorReason: "stage_change:Negotiation", followUpStep: 0, status: "ACTIVE" });
    expect(data.nextFollowUpAt.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });
  it("an excluded stage pauses, unless a person paused it already", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state());
    await onLeadStageChanged("l1", { id: "on-hold", name: "On Hold", isClosed: false, isWon: false, isLost: false });
    expect(db.leadNurtureState.update.mock.calls[0][0].data).toMatchObject({ status: "PAUSED", pausedReason: "stage_excluded" });
    db.leadNurtureState.update.mockClear();
    db.leadNurtureState.findUnique.mockResolvedValue(state({ status: "PAUSED", pausedByUserId: "u1", pausedReason: "manual" }));
    await onLeadStageChanged("l1", { id: "neg", name: "Negotiation", isClosed: false, isWon: false, isLost: false });
    expect(db.leadNurtureState.update.mock.calls[0][0].data.status).toBeUndefined();
  });
  it("a re-opened stopped lead comes back with a fresh anchor and its nurture progress kept", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state({ status: "STOPPED", stoppedReason: "lost", nurtureSlot: 3 }));
    await onLeadStageChanged("l1", { id: "new", name: "New Lead", isClosed: false, isWon: false, isLost: false }, new Date("2026-10-05T14:00:00Z"));
    const data = db.leadNurtureState.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "ACTIVE", followUpStep: 0, nurtureSlot: 3, stoppedReason: null });
  });
  it("is a no-op with no state, and never throws", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(null);
    await onLeadStageChanged("l1", { id: "new", name: "New Lead", isClosed: false, isWon: false, isLost: false });
    expect(db.leadNurtureState.update).not.toHaveBeenCalled();
    db.leadNurtureState.findUnique.mockRejectedValue(new Error("db down"));
    await expect(onLeadStageChanged("l1", { id: "new", name: "New Lead", isClosed: false, isWon: false, isLost: false })).resolves.toBeUndefined();
  });
});

describe("onPersonalTouch", () => {
  it("re-anchors keeping the step, records the touch, clears and closes the prompt", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state({ repPromptedAt: anchor }));
    const at = new Date("2026-10-05T14:00:00Z");
    await onPersonalTouch("l1", at, "communication");
    const data = db.leadNurtureState.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ anchorAt: at, anchorReason: "personal_touch:communication", followUpStep: 2, lastPersonalTouchAt: at, repPromptedAt: null });
    expect(autoTasks.closeAutoTask).toHaveBeenCalledWith("lead:NURTURE_TOUCH:l1", expect.objectContaining({ because: expect.stringMatching(/personal touch/) }));
  });
  it("ignores stopped leads", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state({ status: "STOPPED" }));
    await onPersonalTouch("l1");
    expect(db.leadNurtureState.update).not.toHaveBeenCalled();
  });
});

describe("onEstimateSent", () => {
  it("re-anchors with the step reset", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state());
    await onEstimateSent("l1", new Date("2026-10-05T14:00:00Z"));
    expect(db.leadNurtureState.update.mock.calls[0][0].data).toMatchObject({ anchorReason: "estimate_sent", followUpStep: 0 });
  });
});

describe("setNurtureStatus", () => {
  it("pause records who paused; stop clears the next dates; resume recomputes them", async () => {
    db.leadNurtureState.findUnique.mockResolvedValue(state());
    db.lead.findUnique.mockResolvedValue({ id: "l1", email: "a@b.c", emailOptedOut: false, createdAt: anchor, currentStage: { id: "new", name: "New Lead", isClosed: false } });
    await setNurtureStatus("l1", "pause", "u1");
    expect(db.leadNurtureState.update.mock.calls[0][0].data).toMatchObject({ status: "PAUSED", pausedReason: "manual", pausedByUserId: "u1" });
    await setNurtureStatus("l1", "stop", "u1");
    expect(db.leadNurtureState.update.mock.calls[1][0].data).toMatchObject({ status: "STOPPED", stoppedReason: "manual", nextFollowUpAt: null });
    await setNurtureStatus("l1", "resume", "u1", new Date("2026-10-05T14:00:00Z"));
    const resumed = db.leadNurtureState.update.mock.calls[2][0].data;
    expect(resumed).toMatchObject({ status: "ACTIVE", pausedByUserId: null });
    expect(resumed.nextFollowUpAt).toBeInstanceOf(Date);
  });
  it("refuses to enrol a closed or email-less lead", async () => {
    db.lead.findUnique.mockResolvedValue({ id: "l1", email: null, emailOptedOut: false, createdAt: anchor, currentStage: { id: "new", name: "New Lead", isClosed: false } });
    db.leadNurtureState.findUnique.mockResolvedValue(null);
    expect(await setNurtureStatus("l1", "enrol", "u1")).toBeNull();
  });
});
