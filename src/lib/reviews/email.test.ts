import { describe, expect, it } from "vitest";
import type { EmailBrand } from "@/lib/email/brand";
import { renderReviewRequestEmail } from "./email";

const brand: EmailBrand = {
  id: "default",
  companyName: "Knu Construction",
  addressLine1: "2500 N Federal Highway, Suite 102",
  addressLine2: null,
  city: "Ft Lauderdale",
  state: "FL",
  zip: "33305",
  officePhone: "(561) 910-0142",
  mobilePhone: null,
  contactEmail: null,
  website: null,
  logoUrl: null,
  primaryColor: "#1f2937",
  signatureHtml: null,
  signatureText: null,
  reviewUrl: "https://g.page/r/abc/review",
};

const input = {
  brand,
  firstName: "Maria",
  address: "12 Palm Way, Boca Raton",
  unsubscribeUrl: "https://crm.example.com/api/email/unsubscribe?token=t",
};

describe("renderReviewRequestEmail", () => {
  it("puts the review link in both parts", () => {
    const { html, text, subject } = renderReviewRequestEmail(input);
    expect(html).toContain('href="https://g.page/r/abc/review"');
    expect(html).toContain("Leave a review");
    expect(text).toContain("Leave a review: https://g.page/r/abc/review");
    expect(subject).toContain("Knu Construction");
  });

  it("names the customer and the project, on the branded shell", () => {
    const { html, text } = renderReviewRequestEmail(input);
    expect(html).toContain("Thank you, Maria");
    expect(html).toContain("12 Palm Way, Boca Raton");
    expect(html).toContain("Office: (561) 910-0142");
    expect(text).toContain("at 12 Palm Way, Boca Raton");
  });

  it("carries the unsubscribe link", () => {
    const { html, text } = renderReviewRequestEmail(input);
    expect(html).toContain("Unsubscribe");
    expect(text).toContain(input.unsubscribeUrl);
  });

  it("asks for a reply instead when no review page is set", () => {
    const { html, text } = renderReviewRequestEmail({ ...input, brand: { ...brand, reviewUrl: null } });
    expect(html).not.toContain("Leave a review");
    expect(html).not.toContain("★");
    expect(text).not.toContain("Leave a review");
    expect(text).toContain("Reply to this email");
  });

  it("reads properly with no name or address", () => {
    const { html, text } = renderReviewRequestEmail({ ...input, firstName: "  ", address: null });
    expect(html).toContain(">Thank you<");
    expect(html).not.toContain("Project address");
    expect(text.startsWith("Hello,")).toBe(true);
    expect(text).toContain("Your project is complete.");
  });

  it("escapes what a person typed", () => {
    const { html } = renderReviewRequestEmail({ ...input, firstName: "<b>Al</b>", address: `1 "A" & B St` });
    expect(html).not.toContain("<b>Al</b>");
    expect(html).toContain("&lt;b&gt;Al&lt;/b&gt;");
    expect(html).toContain("&amp; B St");
  });
});
