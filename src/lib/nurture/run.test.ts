import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, email, autoTasks, report, envRef } = vi.hoisted(() => ({
  db: {
    nurtureSettings: { upsert: vi.fn() },
    lead: { findMany: vi.fn() },
    leadStageHistory: { findMany: vi.fn() },
    estimate: { findMany: vi.fn() },
    customerContract: { findMany: vi.fn() },
    communication: { findMany: vi.fn(), create: vi.fn() },
    leadNurtureState: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    leadNurtureSend: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    nurtureContent: { findMany: vi.fn(), update: vi.fn() },
    activityLog: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  email: { sendEmail: vi.fn(), isEmailConfigured: vi.fn(() => true) },
  autoTasks: { closeAutoTask: vi.fn(), ensureAutoTask: vi.fn(), sourceKeyFor: vi.fn((s: { leadId: string }) => `lead:NURTURE_TOUCH:${s.leadId}`) },
  report: { reportDelivery: vi.fn() },
  envRef: { env: { NURTURE_ENABLED: "1", NURTURE_MAX_PER_RUN: "50", EMAIL_FROM: "crm@knu.test", APP_BASE_URL: "https://crm.test", NEXTAUTH_SECRET: "x".repeat(32) } },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/env", () => envRef);
vi.mock("@/lib/email/send", () => email);
vi.mock("@/lib/email/brand", () => ({ getEmailBrand: async () => ({ id: "default", companyName: "Knu", addressLine1: null, addressLine2: null, city: null, state: null, zip: null, officePhone: "555", mobilePhone: null, contactEmail: null, website: null, logoUrl: null, primaryColor: "#000", signatureHtml: null, signatureText: null }), formatBrandAddress: () => "" }));
vi.mock("@/lib/email/delivery-report", () => report);
vi.mock("@/lib/tasks/auto-tasks", () => autoTasks);
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), info: vi.fn() } }));

const { runNurtureTick } = await import("./run");

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
  excludedStageIds: [],
};
const now = new Date("2026-10-01T13:30:00Z"); // Thu 09:30 EDT
const anchor = new Date("2026-09-23T14:00:00Z");
const stage = { id: "new", name: "New Lead", isClosed: false, isWon: false, isLost: false };
const lead = (o: Record<string, unknown> = {}) => ({
  id: "l1",
  firstName: "Jane",
  lastName: "Doe",
  fullName: "Jane Doe",
  primaryPhone: "555",
  email: "jane@example.com",
  city: "FTL",
  propertyAddress1: "1 Main",
  companyName: null,
  emailOptedOut: false,
  assignedUserId: "rep",
  createdByUserId: "rep",
  createdAt: anchor,
  currentStage: stage,
  assignedUser: { id: "rep", firstName: "Rick", lastName: "Rep", email: "rick@knu.test", signatureHtml: null, signatureText: null },
  ...o,
});
const state = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  leadId: "l1",
  status: "ACTIVE",
  anchorAt: anchor,
  followUpStep: 0,
  nurtureBaseAt: anchor,
  nurtureSlot: 0,
  nextFollowUpAt: new Date("2026-09-25T12:00:00Z"),
  nextNurtureAt: new Date("2026-09-29T12:00:00Z"),
  lastFollowUpAt: null,
  lastNurtureAt: null,
  lastAutoEmailAt: null,
  lastPersonalTouchAt: null,
  repPromptedAt: null,
  stepsExhaustedNotifiedAt: null,
  nurtureExhaustedAt: null,
  pausedByUserId: null,
  pausedReason: null,
  stoppedReason: null,
  enrolledAt: anchor,
  lead: lead(),
  ...o,
});
const content = [
  { id: "f1", kind: "FOLLOW_UP", step: 1, subject: "Did it arrive, {{lead.firstName}}?", body: "Hi {{lead.firstName}}", isActive: true, sortOrder: 1 },
  { id: "f2", kind: "FOLLOW_UP", step: 2, subject: "Questions?", body: "…", isActive: true, sortOrder: 2 },
  { id: "n1", kind: "NURTURE", step: null, subject: "About us", body: "…", isActive: true, sortOrder: 10 },
];

beforeEach(() => {
  for (const g of Object.values(db)) {
    if (typeof g === "function") (g as ReturnType<typeof vi.fn>).mockReset();
    else for (const fn of Object.values(g as Record<string, ReturnType<typeof vi.fn>>)) fn.mockReset();
  }
  for (const fn of Object.values(autoTasks)) fn.mockReset();
  autoTasks.sourceKeyFor.mockImplementation((s: { leadId: string }) => `lead:NURTURE_TOUCH:${s.leadId}`);
  report.reportDelivery.mockReset();
  email.sendEmail.mockReset();
  email.isEmailConfigured.mockReturnValue(true);
  envRef.env.NURTURE_ENABLED = "1";
  db.nurtureSettings.upsert.mockResolvedValue(settings);
  db.lead.findMany.mockResolvedValue([]);
  db.leadStageHistory.findMany.mockResolvedValue([]);
  db.estimate.findMany.mockResolvedValue([]);
  db.customerContract.findMany.mockResolvedValue([]);
  db.communication.findMany.mockResolvedValue([]);
  db.leadNurtureState.findMany.mockResolvedValue([]);
  db.leadNurtureSend.findMany.mockResolvedValue([]);
  db.leadNurtureSend.create.mockResolvedValue({ id: "send1" });
  db.nurtureContent.findMany.mockResolvedValue(content);
  db.communication.create.mockResolvedValue({ id: "c1" });
  db.user.findFirst.mockResolvedValue({ id: "admin" });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  email.sendEmail.mockResolvedValue({ id: "msg1" });
});

describe("runNurtureTick", () => {
  it("does nothing when the env gate is off (but a dry run still plans)", async () => {
    envRef.env.NURTURE_ENABLED = "0";
    const r = await runNurtureTick(now);
    expect(r.enabled).toBe(false);
    expect(db.lead.findMany).not.toHaveBeenCalled();
    db.leadNurtureState.findMany.mockResolvedValue([state()]);
    const dry = await runNurtureTick(now, { dryRun: true });
    expect(dry.plan.some((p) => p.kind === "FOLLOW_UP")).toBe(true);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(db.leadNurtureSend.create).not.toHaveBeenCalled();
  });

  it("a dry run plans the leads it would enrol, without writing them", async () => {
    db.lead.findMany.mockResolvedValue([lead({ createdAt: new Date("2026-09-26T14:00:00Z") })]);
    const r = await runNurtureTick(now, { dryRun: true });
    expect(r.enrolled).toBe(1);
    expect(db.leadNurtureState.createMany).not.toHaveBeenCalled();
    expect(r.due).toBe(1);
    expect(r.plan.find((p) => p.kind === "FOLLOW_UP")).toMatchObject({ leadId: "l1", subject: "Did it arrive, Jane?" });
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("enrols open leads with an email that have no state", async () => {
    db.lead.findMany.mockResolvedValue([lead(), lead({ id: "l2", email: " " })]);
    const r = await runNurtureTick(now);
    expect(r.enrolled).toBe(1);
    const rows = db.leadNurtureState.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ leadId: "l1", status: "ACTIVE", followUpStep: 0 });
    expect(rows[0].nextFollowUpAt).toBeInstanceOf(Date);
  });

  it("stops a won lead during reconcile and cancels its prompt task", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state({ lead: lead({ currentStage: { ...stage, isClosed: true, isWon: true } }) })]);
    const r = await runNurtureTick(now);
    expect(r.stopped).toBe(1);
    expect(db.leadNurtureState.update.mock.calls[0][0].data).toMatchObject({ status: "STOPPED", stoppedReason: "won" });
    expect(autoTasks.closeAutoTask).toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("sends the due follow-up from the rep, logs it without touching lastContactAt, and advances the state", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state()]);
    const r = await runNurtureTick(now);
    expect(r.sent).toBe(1);
    const args = email.sendEmail.mock.calls[0][0];
    expect(args.to).toBe("jane@example.com");
    expect(args.subject).toBe("Did it arrive, Jane?");
    expect(args.replyTo).toBe("rick@knu.test");
    // The unsubscribe link lives in the body; custom headers are rejected by the MailerSend plan.
    expect(args.headers).toBeUndefined();
    expect(args.html).toContain("/api/email/unsubscribe?token=");
    expect(args.text).toContain("/api/email/unsubscribe?token=");
    expect(db.leadNurtureSend.create.mock.calls[0][0].data).toMatchObject({ kind: "FOLLOW_UP", step: 1, slotKey: "FOLLOW_UP:2026-10-01", status: "FAILED", error: "in flight" });
    expect(db.leadNurtureSend.update.mock.calls[0][0].data).toMatchObject({ status: "SENT", externalMessageId: "msg1" });
    expect(db.communication.create.mock.calls[0][0].data).toMatchObject({ provider: "nurture", createdByUserId: null, direction: "OUTBOUND" });
    expect(db.activityLog.create.mock.calls[0][0].data.title).toMatch(/^Automated follow-up: /);
    const stateUpdate = db.leadNurtureState.update.mock.calls.find((c) => c[0].data.followUpStep !== undefined)![0].data;
    expect(stateUpdate.followUpStep).toBe(1);
    expect(stateUpdate.lastAutoEmailAt).toEqual(now);
    expect(report.reportDelivery).toHaveBeenCalledWith(expect.objectContaining({ source: "cron.nurture", attempted: 1, sent: 1, failures: [] }));
    // lastContactAt belongs to personal contact; the runner never writes the lead row.
    expect(JSON.stringify(db.leadNurtureState.update.mock.calls)).not.toContain("lastContactAt");
  });

  it("sends the next unsent nurture piece when only nurture is due, and marks the library exhausted on the last one", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state({ nextFollowUpAt: new Date("2026-10-15T12:00:00Z") })]);
    const r = await runNurtureTick(now);
    expect(r.sent).toBe(1);
    expect(email.sendEmail.mock.calls[0][0].subject).toBe("About us");
    const stateUpdate = db.leadNurtureState.update.mock.calls.find((c) => c[0].data.nurtureSlot !== undefined)![0].data;
    expect(stateUpdate.nurtureSlot).toBe(1);
    expect(stateUpdate.nurtureExhaustedAt).toEqual(now);
  });

  it("skips a follow-up after a recent personal touch, advancing the step without sending", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state({ lastPersonalTouchAt: new Date("2026-09-30T12:00:00Z") })]);
    const r = await runNurtureTick(now);
    expect(r.skipped).toBe(1);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(db.leadNurtureSend.create.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED" });
    expect(db.leadNurtureState.update.mock.calls[0][0].data.followUpStep).toBe(1);
  });

  it("mails the same address only once per run", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state(), state({ id: "s2", leadId: "l2", lead: lead({ id: "l2", email: "JANE@example.com" }) })]);
    const r = await runNurtureTick(now);
    expect(r.sent).toBe(1);
    expect(r.plan.filter((p) => p.kind === "NONE").map((p) => p.reason)).toContain("same email address already mailed within the gap");
  });

  it("treats a duplicate slot as already done today", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state()]);
    const { Prisma } = await import("@/generated/prisma/client");
    db.leadNurtureSend.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    const r = await runNurtureTick(now);
    expect(r.sent).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(r.plan.filter((p) => p.leadId === "l1")).toEqual([expect.objectContaining({ kind: "NONE", reason: "slot already used today" })]);
    expect(r.planned).toBe(0);
  });

  it("records a failed send, leaves the state where it was, and reports it", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state()]);
    email.sendEmail.mockRejectedValue(new Error("mailer down"));
    db.leadNurtureSend.findMany.mockResolvedValue([]);
    const r = await runNurtureTick(now);
    expect(r.failed).toBe(1);
    expect(db.leadNurtureSend.update.mock.calls[0][0].data).toEqual({ error: "mailer down" });
    expect(db.leadNurtureState.update).not.toHaveBeenCalled();
    expect(report.reportDelivery.mock.calls[0][0].failures).toEqual([{ recipient: "jane@example.com", reason: "mailer down" }]);
  });

  it("respects the cap", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([state(), state({ id: "s2", leadId: "l2", lead: lead({ id: "l2", email: "b@example.com" }) })]);
    const r = await runNurtureTick(now, { limit: 1 });
    expect(r.due).toBe(2);
    expect(r.sent).toBe(1);
  });

  it("prompts the rep after ten quiet days and once when the scripted steps run out", async () => {
    db.leadNurtureState.findMany.mockResolvedValue([
      state({ id: "quiet", leadId: "lq", nextFollowUpAt: new Date("2026-12-01"), nextNurtureAt: new Date("2026-12-01"), enrolledAt: new Date("2026-09-01"), anchorAt: new Date("2026-09-01"), lead: lead({ id: "lq" }) }),
      state({ id: "done", leadId: "ld", followUpStep: 4, nextFollowUpAt: new Date("2026-12-01"), nextNurtureAt: new Date("2026-12-01"), enrolledAt: now, anchorAt: now, lead: lead({ id: "ld" }) }),
    ]);
    const r = await runNurtureTick(now);
    expect(r.prompts).toBe(2);
    expect(autoTasks.ensureAutoTask).toHaveBeenCalledWith({ kind: "nurture.personal-touch", leadId: "lq" }, "rep", now);
    expect(autoTasks.ensureAutoTask).toHaveBeenCalledWith({ kind: "nurture.personal-touch", leadId: "ld" }, "rep", now);
    expect(db.leadNurtureState.update.mock.calls.find((c) => c[0].where.id === "done")![0].data).toMatchObject({ stepsExhaustedNotifiedAt: now });
  });
});
