import { describe, expect, it } from "vitest";
import { renderEmailLayout } from "./layout";
import type { EmailBrand } from "./brand";

const brand: EmailBrand = {
  id: "default",
  companyName: "Knu Construction",
  addressLine1: "2500 N Federal Highway, Suite 102",
  addressLine2: null,
  city: "Ft Lauderdale",
  state: "FL",
  zip: "33305",
  officePhone: "(561) 910-0142",
  mobilePhone: "(561) 785-9122",
  contactEmail: null,
  website: null,
  logoUrl: null,
  primaryColor: "#1f2937",
  signatureHtml: null,
  signatureText: null,
};

describe("renderEmailLayout", () => {
  it("wraps the body and includes the company name in the header", () => {
    const { html } = renderEmailLayout({
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      brand,
    });
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain("Knu Construction");
  });

  it("includes the default signature pulled from brand fields", () => {
    const { html, text } = renderEmailLayout({
      bodyHtml: "<p>x</p>",
      bodyText: "x",
      brand,
    });
    expect(html).toContain("Office: (561) 910-0142");
    expect(html).toContain("Cell: (561) 785-9122");
    expect(text).toContain("Office: (561) 910-0142");
    expect(text).toContain("Cell: (561) 785-9122");
  });

  it("uses overridden signature when provided", () => {
    const { html, text } = renderEmailLayout({
      bodyHtml: "<p>x</p>",
      bodyText: "x",
      brand,
      signatureHtml: "<em>Sam Rep</em>",
      signatureText: "Sam Rep",
    });
    expect(html).toContain("<em>Sam Rep</em>");
    expect(html).not.toContain("Office: (561) 910-0142");
    expect(text).toContain("Sam Rep");
  });

  it("includes the unsubscribe link when present", () => {
    const { html, text } = renderEmailLayout({
      bodyHtml: "<p>x</p>",
      bodyText: "x",
      brand,
      unsubscribeUrl: "https://crm.example.com/api/email/unsubscribe?token=abc",
    });
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("token=abc");
    expect(text).toContain("Unsubscribe: https://crm.example.com/api/email/unsubscribe?token=abc");
  });

  it("escapes HTML in brand fields to prevent injection", () => {
    const xssBrand = { ...brand, companyName: "<script>alert(1)</script>" };
    const { html } = renderEmailLayout({
      bodyHtml: "<p>x</p>",
      bodyText: "x",
      brand: xssBrand,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
