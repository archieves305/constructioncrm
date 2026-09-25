import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, sendEmail, resolveRecipients, reportDelivery, recordCaseBell, env } = vi.hoisted(() => ({
  db: {
    codeViolationCase: { findMany: vi.fn() },
    codeViolationReminderLog: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
  sendEmail: vi.fn(),
  resolveRecipients: vi.fn(),
  reportDelivery: vi.fn(),
  recordCaseBell: vi.fn(),
  env: { VIOLATION_ESCALATIONS_ENABLED: "1", VIOLATION_ESCALATION_DAYS: "1,3,7", APP_BASE_URL: "https://crm.test" },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/email/send", () => ({ sendEmail, isEmailConfigured: () => true }));
vi.mock("@/lib/email/brand", () => ({ getEmailBrand: async () => ({ companyName: "KNU", primaryColor: "#123456", logoUrl: null, signatureHtml: null, signatureText: null }), formatBrandAddress: () => "" }));
vi.mock("@/lib/email/delivery-report", () => ({ reportDelivery }));
vi.mock("@/lib/tasks/recipients", () => ({ resolveRecipients }));
vi.mock("./notify", () => ({ recordCaseBell, caseUrl: (id: string, tab?: string | null) => `https://crm.test/violations/${id}${tab ? `?tab=${tab}` : ""}` }));

const { runViolationReminders, runViolationEscalations } = await import("./reminder-run");

const now = new Date("2026-10-17T12:00:00Z"); // 3 days before Oct 20
const money = (v: string | null) => v;
const caseRow = (over: Record<string, unknown> = {}) => ({
  id: "c1", caseNumber: "CV-00001", title: "Roof", leadId: "l1", status: "ACTIVE", jurisdiction: "SRC", caseManagerId: "cm",
  currentDeadline: new Date("2026-10-20T17:00:00Z"), appealDeadline: null, agencyConfirmedAt: null,
  initialFine: money("250"), dailyFine: money("50"), fineAccrualStartDate: null, fineAccrualStoppedAt: null, adminCosts: money("0"), amountPaid: money("0"), mitigationGrantedAmount: null, fineEstimateOverride: null, fineEstimateOverrideReason: null, fineEstimateOverrideAt: null, fineTermsUpdatedAt: null, officialBalance: null, officialBalanceAsOf: null,
  lead: { propertyAddress1: "2192 Wind Trace", city: "Navarre" }, caseManager: { firstName: "Sarah", lastName: "Manager" },
  hearings: [], inspections: [], job: null, ...over,
});
const sarah = { userId: "cm", email: "sarah@x.test", firstName: "Sarah", lastName: "Manager", role: "MANAGER", reason: "assignee" };

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  for (const fn of [sendEmail, resolveRecipients, reportDelivery, recordCaseBell]) fn.mockReset();
  db.codeViolationReminderLog.findMany.mockResolvedValue([]);
  db.codeViolationReminderLog.createMany.mockResolvedValue({ count: 1 });
  db.codeViolationReminderLog.deleteMany.mockResolvedValue({ count: 1 });
  db.user.findMany.mockResolvedValue([]);
  resolveRecipients.mockResolvedValue({ recipients: [sarah], skipped: [] });
  sendEmail.mockResolvedValue({ id: "m1" });
  recordCaseBell.mockResolvedValue(undefined);
  env.VIOLATION_ESCALATIONS_ENABLED = "1";
});

describe("runViolationReminders", () => {
  it("logs before sending, sends one mail per person, and drops a bell row per item", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow({ hearings: [{ id: "h1", scheduledAt: new Date("2026-10-18T14:00:00Z"), status: "SCHEDULED", type: "APPEAL", attendeeUserId: "cm" }] })]);
    const r = await runViolationReminders(now);
    expect(r).toMatchObject({ cases: 1, deadlines: 2, planned: 2, people: 1, sent: 1, failures: [] });
    const logged = db.codeViolationReminderLog.createMany.mock.calls[0][0].data;
    expect(logged.map((l: { kind: string; offsetKey: string; entityId: string }) => [l.kind, l.entityId, l.offsetKey])).toEqual([["COMPLIANCE", "deadline@2026-10-20", "d3"], ["HEARING", "h1@2026-10-18", "d1"]]);
    expect(db.codeViolationReminderLog.createMany.mock.invocationCallOrder[0]).toBeLessThan(sendEmail.mock.invocationCallOrder[0]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toBe("2 code violation deadlines coming up");
    expect(recordCaseBell).toHaveBeenCalledTimes(2);
    expect(db.codeViolationReminderLog.deleteMany).not.toHaveBeenCalled();
  });

  it("a second run the same day plans nothing (the log is the ledger)", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow()]);
    db.codeViolationReminderLog.findMany.mockResolvedValue([{ caseId: "c1", kind: "COMPLIANCE", entityId: "deadline@2026-10-20", offsetKey: "d3" }]);
    const r = await runViolationReminders(now);
    expect(r).toMatchObject({ planned: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.codeViolationReminderLog.createMany).not.toHaveBeenCalled();
  });

  it("a failed send removes its log rows so tomorrow retries", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow()]);
    sendEmail.mockRejectedValue(new Error("mailersend down"));
    const r = await runViolationReminders(now);
    expect(r).toMatchObject({ sent: 0, failures: ["sarah@x.test"] });
    expect(db.codeViolationReminderLog.deleteMany.mock.calls[0][0].where.OR).toEqual([{ caseId: "c1", kind: "COMPLIANCE", entityId: "deadline@2026-10-20", offsetKey: "d3" }]);
    expect(recordCaseBell).not.toHaveBeenCalled();
    expect(reportDelivery.mock.calls[0][0]).toMatchObject({ source: "cron.violation-reminders", attempted: 1, sent: 0 });
  });

  it("a muted recipient's reminder is logged as sent nowhere, so it stops re-planning", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow()]);
    resolveRecipients.mockResolvedValue({ recipients: [], skipped: [{ userId: "cm", reason: "muted" }] });
    await runViolationReminders(now);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.codeViolationReminderLog.createMany.mock.calls[0][0].data[0]).toMatchObject({ offsetKey: "d3", channel: "none", recipientUserIds: [] });
  });

  it("an overdue compliance deadline goes out daily under an od:<day> key", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow()]);
    const r = await runViolationReminders(new Date("2026-10-23T12:00:00Z"));
    expect(r.sent).toBe(1);
    expect(db.codeViolationReminderLog.createMany.mock.calls[0][0].data[0].offsetKey).toBe("od:2026-10-23");
    expect(sendEmail.mock.calls[0][0].subject).toBe("1 overdue code violation deadline");
  });
});

describe("runViolationEscalations", () => {
  it("is off unless enabled", async () => {
    env.VIOLATION_ESCALATIONS_ENABLED = "0";
    expect(await runViolationEscalations(now)).toMatchObject({ enabled: false });
    expect(db.codeViolationCase.findMany).not.toHaveBeenCalled();
  });

  it("escalates to the crossed level, mails the audience once each, and advances the ledger only after a successful send", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow({ currentDeadline: new Date("2026-10-12T17:00:00Z") })]); // 5 days overdue on Oct 17 → level 2
    db.user.findMany.mockResolvedValueOnce([{ id: "m1" }]).mockResolvedValueOnce([{ id: "a1" }]);
    const mgr = { ...sarah, userId: "m1", email: "m1@x.test", firstName: "Mo", reason: "manager" };
    resolveRecipients.mockResolvedValue({ recipients: [sarah, mgr], skipped: [] });
    const r = await runViolationEscalations(now);
    expect(r).toMatchObject({ enabled: true, cases: 1, escalated: 1, people: 2, sent: 2 });
    expect(resolveRecipients.mock.calls[0][0].candidates.map((c: { userId: string }) => c.userId)).toEqual(["cm", "m1"]);
    expect(sendEmail.mock.calls[0][0].subject).toBe("Overdue 5 days: CV-00001 Roof");
    expect(sendEmail.mock.calls[0][0].text).toContain("These cases you manage");
    expect(sendEmail.mock.calls[1][0].text).toContain("as a manager");
    const ledger = db.codeViolationReminderLog.createMany.mock.calls[0][0].data[0];
    expect(ledger).toMatchObject({ caseId: "c1", kind: "COMPLIANCE", entityId: "deadline@2026-10-12", offsetKey: "esc:2", recipientUserIds: ["cm", "m1"] });
  });

  it("does not re-escalate a level already logged, and skips the ledger when nobody was reached", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([caseRow({ currentDeadline: new Date("2026-10-12T17:00:00Z") })]);
    db.codeViolationReminderLog.findMany.mockResolvedValue([{ caseId: "c1", entityId: "deadline@2026-10-12", offsetKey: "esc:2" }]);
    expect(await runViolationEscalations(now)).toMatchObject({ cases: 1, escalated: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();

    db.codeViolationReminderLog.findMany.mockResolvedValue([]);
    sendEmail.mockRejectedValue(new Error("down"));
    const r = await runViolationEscalations(now);
    expect(r).toMatchObject({ escalated: 0, failures: ["sarah@x.test"] });
    expect(db.codeViolationReminderLog.createMany).not.toHaveBeenCalled();
  });
});
