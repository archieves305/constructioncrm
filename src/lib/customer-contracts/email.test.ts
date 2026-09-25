import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail, brand } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  brand: { id: "default", companyName: "Knu Construction", addressLine1: null, addressLine2: null, city: null, state: null, zip: null, officePhone: null, mobilePhone: null, contactEmail: "office@knu.test", website: null, logoUrl: null, primaryColor: "#0f766e", signatureHtml: null, signatureText: null },
}));
vi.mock("@/lib/email/send", () => ({ sendEmail }));
vi.mock("@/lib/email/brand", () => ({ getEmailBrand: async () => brand, formatBrandAddress: () => "" }));
vi.mock("@/lib/env", () => ({ env: { APP_BASE_URL: "https://crm.careyos.com/", NEXTAUTH_URL: "https://crm.careyos.com" } }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn() } }));

const { sendContractEmail, signUrlFor } = await import("./email");

const contract = {
  id: "c1",
  jobId: "j1",
  contractNumber: "JOB-1-C1",
  contractAmount: "25000",
  tokenExpiresAt: new Date("2026-10-25T12:00:00Z"),
  signerName: null,
  signerEmail: null,
  signedAt: null,
  declineReason: null,
  job: { jobNumber: "JOB-1", title: "Roof <script>alert(1)</script>", lead: { fullName: "Jane O'Neil", email: "jane@example.com" } },
  snapshot: {
    template: { title: "Agreement" },
    price: { total: 25000 },
    depositAmount: 10000,
    jobSite: { line1: "1 Main & Co", city: "FTL" },
    paymentSchedule: [{ label: "Deposit", amount: 10000, trigger: "on signing" }],
  },
};

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ id: "m1" });
});

describe("contract emails", () => {
  it("builds the sign URL from APP_BASE_URL without a double slash", () => {
    expect(signUrlFor("abc")).toBe("https://crm.careyos.com/sign/abc");
  });

  it("escapes every interpolated string and attaches the PDF", async () => {
    const ok = await sendContractEmail(contract, Buffer.from("%PDF"), { to: "jane@example.com", token: "tok", message: "See <b>you</b> soon" });
    expect(ok).toBe(true);
    const args = sendEmail.mock.calls[0][0];
    expect(args.to).toBe("jane@example.com");
    expect(args.html).not.toContain("<script>");
    expect(args.html).toContain("&lt;script&gt;");
    expect(args.html).toContain("1 Main &amp; Co");
    expect(args.html).toContain("See &lt;b&gt;you&lt;/b&gt; soon");
    expect(args.html).toContain("https://crm.careyos.com/sign/tok");
    expect(args.html).toContain("October 25, 2026");
    expect(args.text).toContain("Review & sign: https://crm.careyos.com/sign/tok");
    expect(args.attachments).toEqual([{ filename: "JOB-1-C1.pdf", contentBase64: Buffer.from("%PDF").toString("base64") }]);
  });

  it("reports false when the mailer is not configured", async () => {
    sendEmail.mockResolvedValue(null);
    expect(await sendContractEmail(contract, Buffer.from("%PDF"), { to: "jane@example.com", token: "tok" })).toBe(false);
  });
});
