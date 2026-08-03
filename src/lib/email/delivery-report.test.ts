import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const isEmailConfigured = vi.fn(() => true);
const recordAudit = vi.fn();
const loggerError = vi.fn();
const loggerInfo = vi.fn();
const findFirst = vi.fn();

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  isEmailConfigured: () => isEmailConfigured(),
}));
vi.mock("@/lib/audit/record", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (...a: unknown[]) => loggerError(...a),
    info: (...a: unknown[]) => loggerInfo(...a),
    warn: vi.fn(),
    exception: vi.fn(),
  },
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));
vi.mock("@/lib/email/brand", () => ({
  // renderEmailLayout pulls formatBrandAddress from this module too, so a
  // partial mock silently breaks rendering inside the alert path.
  formatBrandAddress: () => "",
  getEmailBrand: async () => ({
    id: "d",
    companyName: "Knu Construction",
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    officePhone: null,
    mobilePhone: null,
    contactEmail: null,
    website: null,
    logoUrl: null,
    primaryColor: "#1f2937",
    signatureHtml: null,
    signatureText: null,
  }),
}));

const { reportDelivery, DELIVERY_FAILURE_MARKER } = await import("./delivery-report");

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ id: "msg" });
  isEmailConfigured.mockReset().mockReturnValue(true);
  recordAudit.mockReset();
  loggerError.mockReset();
  loggerInfo.mockReset();
  findFirst.mockReset().mockResolvedValue({ email: "admin@knuco.com" });
});

const ok = { source: "cron.x", attempted: 3, sent: 3, failures: [] };

describe("reportDelivery", () => {
  it("stays quiet when everything delivered", async () => {
    await reportDelivery(ok);
    expect(loggerError).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    // Still logs the happy path, so "no news" is not ambiguous.
    expect(loggerInfo).toHaveBeenCalled();
  });

  it("does nothing at all when no sends were attempted", async () => {
    await reportDelivery({ source: "cron.x", attempted: 0, sent: 0, failures: [] });
    expect(loggerInfo).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("logs, audits and alerts on a partial failure", async () => {
    await reportDelivery({
      source: "cron.task-reminders",
      attempted: 4,
      sent: 2,
      failures: [
        { recipient: "a@x.com", reason: "422 cap" },
        { recipient: "b@x.com", reason: "422 cap" },
      ],
    });

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining(DELIVERY_FAILURE_MARKER),
      expect.objectContaining({ attempted: 4, sent: 2, failed: 2 }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "EmailDelivery",
        entityId: "cron.task-reminders",
        action: "delivery_failure",
      }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [args] = sendEmail.mock.calls[0] as [{ to: string; subject: string; html: string }];
    expect(args.to).toBe("admin@knuco.com");
    expect(args.subject).toContain("cron.task-reminders");
    expect(args.html).toContain("a@x.com");
  });

  it("treats sent:0 with no errors as a failure, not a success", async () => {
    // This is the silent-skip case: sendEmail returned null for everyone
    // because the provider is unconfigured. It used to be indistinguishable
    // from a clean run.
    await reportDelivery({ source: "cron.x", attempted: 3, sent: 0, failures: [] });
    expect(loggerError).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalled();
    // ...but do not try to email an alert when email is what is broken.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not attempt an alert when email is unconfigured", async () => {
    isEmailConfigured.mockReturnValue(false);
    await reportDelivery({
      source: "cron.x",
      attempted: 1,
      sent: 0,
      failures: [{ recipient: "a@x.com", reason: "boom" }],
    });
    expect(recordAudit).toHaveBeenCalled(); // durable record still written
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never lets a failing alert throw into the calling job", async () => {
    sendEmail.mockRejectedValue(new Error("provider down"));
    await expect(
      reportDelivery({
        source: "cron.x",
        attempted: 1,
        sent: 0,
        failures: [{ recipient: "a@x.com", reason: "boom" }],
      }),
    ).resolves.toBeUndefined();
    expect(recordAudit).toHaveBeenCalled();
  });

  it("does not alert about its own alert failing", async () => {
    // The alert is itself a send. If reporting recursed, this would loop.
    sendEmail.mockImplementation(async () => {
      await reportDelivery({
        source: "tasks.assigned",
        attempted: 1,
        sent: 0,
        failures: [{ recipient: "loop@x.com", reason: "inner" }],
      });
      return { id: "m" };
    });

    await reportDelivery({
      source: "cron.x",
      attempted: 1,
      sent: 0,
      failures: [{ recipient: "a@x.com", reason: "boom" }],
    });

    // The inner call still records durably, but must not send a second alert.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("falls back to the oldest active admin when OPS_ALERT_EMAIL is unset", async () => {
    await reportDelivery({
      source: "cron.x",
      attempted: 1,
      sent: 0,
      failures: [{ recipient: "a@x.com", reason: "boom" }],
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it("skips the alert silently when there is no admin to tell", async () => {
    findFirst.mockResolvedValue(null);
    await reportDelivery({
      source: "cron.x",
      attempted: 1,
      sent: 0,
      failures: [{ recipient: "a@x.com", reason: "boom" }],
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalled();
  });
});
