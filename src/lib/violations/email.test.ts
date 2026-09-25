import { describe, expect, it } from "vitest";
import type { EmailBrand } from "@/lib/email/brand";
import { renderCaseEscalationEmail, renderCaseNoticeEmail, renderViolationDeadlineEmail } from "./email";

const brand: EmailBrand = { companyName: "KNU", primaryColor: "#123456", logoUrl: null, signatureHtml: null, signatureText: null, address: null, phone: null, website: null } as unknown as EmailBrand;
const item = (over: Partial<Parameters<typeof renderViolationDeadlineEmail>[0]["overdue"][number]> = {}) => ({ caseNumber: "CV-00001", caseTitle: "Roof <b>no permit</b>", property: "2192 Wind Trace, Navarre", label: "Compliance deadline", at: new Date("2026-10-20T17:00:00Z"), daysRemaining: 3, url: "https://crm.example/violations/c1", ...over });

describe("renderViolationDeadlineEmail", () => {
  it("names the one upcoming deadline in the subject and escapes the body", () => {
    const e = renderViolationDeadlineEmail({ recipientFirstName: "Sarah", overdue: [], dueToday: [], upcoming: [item()], brand });
    expect(e.subject).toBe("CV-00001: Compliance deadline in 3 days");
    expect(e.html).toContain("Roof &lt;b&gt;no permit&lt;/b&gt;");
    expect(e.html).not.toContain("<b>no permit</b>");
    expect(e.text).toContain("COMING UP");
    expect(e.text).toContain("https://crm.example/violations/c1");
  });
  it("leads with the overdue count when anything is overdue", () => {
    const e = renderViolationDeadlineEmail({ recipientFirstName: "Sarah", overdue: [item({ daysRemaining: -2 }), item({ caseNumber: "CV-00002", daysRemaining: -9 })], dueToday: [item({ daysRemaining: 0 })], upcoming: [], brand });
    expect(e.subject).toBe("2 overdue code violation deadlines");
    expect(e.html).toContain("2d overdue");
    expect(e.html).toContain("Due today");
  });
});

describe("renderCaseEscalationEmail", () => {
  it("frames the intro by the recipient's reason and lists exposure", () => {
    const e = renderCaseEscalationEmail({ recipientFirstName: "Al", recipientReason: "admin", items: [{ caseNumber: "CV-00001", caseTitle: "T", property: "P", jurisdiction: "Santa Rosa County", deadline: new Date("2026-10-05T17:00:00Z"), daysOverdue: 9, level: 3, caseManagerName: "Sarah Manager", exposure: "$700", url: "u" }], brand });
    expect(e.subject).toBe("Overdue 9 days: CV-00001 T");
    expect(e.text).toContain("as an admin");
    expect(e.text).toContain("est. exposure $700");
  });
});

describe("renderCaseNoticeEmail", () => {
  it("renders rows and the CTA", () => {
    const e = renderCaseNoticeEmail({ recipientFirstName: "Sarah", eyebrow: "Code violation", title: "Assigned", intro: "x", rows: [{ label: "Case", value: "CV-1 & co" }], url: "https://u", cta: "Open", brand, subject: "S" });
    expect(e.html).toContain("CV-1 &amp; co");
    expect(e.text).toContain("Open: https://u");
  });
});
