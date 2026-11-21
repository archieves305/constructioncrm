import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  existing: vi.fn(),
  job: vi.fn(),
  user: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  activity: vi.fn(),
  send: vi.fn(),
  report: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reviewRequest: { findFirst: m.existing, create: m.create, update: m.update },
    job: { findUnique: m.job },
    user: { findUnique: m.user },
    activityLog: { create: m.activity },
  },
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: m.send, isEmailConfigured: () => true }));
vi.mock("@/lib/email/delivery-report", () => ({ reportDelivery: m.report }));
vi.mock("@/lib/email/unsubscribe", () => ({ buildUnsubscribeUrl: () => "https://crm.example.com/unsub" }));
vi.mock("@/lib/communications/log", () => ({ logOutboundCommunication: m.log }));
vi.mock("@/lib/email/brand", async (original) => ({
  ...(await original<typeof import("@/lib/email/brand")>()),
  getEmailBrand: async () => ({
    id: "default",
    companyName: "Knu Construction",
    primaryColor: "#1f2937",
    reviewUrl: "https://g.page/r/abc/review",
  }),
}));

import { sendReviewRequestIfNeeded } from "./jobs";

const lead = {
  kind: "CUSTOMER",
  email: "maria@example.com",
  emailOptedOut: false,
  firstName: "Maria",
  propertyAddress1: "12 Palm Way",
  propertyAddress2: null,
  city: "Boca Raton",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.existing.mockResolvedValue(null);
  m.job.mockResolvedValue({ lead });
  m.user.mockResolvedValue({ email: "rep@knu.example" });
  m.create.mockResolvedValue({ id: "r1" });
  m.send.mockResolvedValue({ id: "msg" });
});

describe("sendReviewRequestIfNeeded", () => {
  it("sends the branded email with the review link, replying to the person who closed the job", async () => {
    await sendReviewRequestIfNeeded("j1", "l1", "u1");
    const args = m.send.mock.calls[0]![0];
    expect(args.to).toBe("maria@example.com");
    expect(args.replyTo).toBe("rep@knu.example");
    expect(args.html).toContain("https://g.page/r/abc/review");
    expect(args.html).toContain("https://crm.example.com/unsub");
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
  });

  it("asks once per job", async () => {
    m.existing.mockResolvedValue({ id: "r0" });
    await sendReviewRequestIfNeeded("j1", "l1", "u1");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("sends nothing to a customer who opted out, and leaves the request pending", async () => {
    m.job.mockResolvedValue({ lead: { ...lead, emailOptedOut: true } });
    await sendReviewRequestIfNeeded("j1", "l1", "u1");
    expect(m.create).toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("does not ask a GC", async () => {
    m.job.mockResolvedValue({ lead: { ...lead, kind: "GC_BID" } });
    await sendReviewRequestIfNeeded("j1", "l1", "u1");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("reports a failed send and does not mark it sent", async () => {
    m.send.mockRejectedValue(new Error("MailerSend error (422)"));
    await sendReviewRequestIfNeeded("j1", "l1", "u1");
    expect(m.update).not.toHaveBeenCalled();
    expect(m.report).toHaveBeenCalledWith(expect.objectContaining({ source: "job.review-request", sent: 0 }));
  });
});
