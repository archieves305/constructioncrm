import { describe, expect, it } from "vitest";
import { parseTemplateContent, templateContentHash, validateTemplateContent } from "./template-content";
import type { ContractTemplateContent } from "./types";

const good: ContractTemplateContent = {
  title: "Agreement",
  articles: [
    { key: "parties", title: "Parties", body: "{{company.name}} and {{customer.name}}." },
    { key: "price", title: "Price", body: "{{contract.total}}, deposit {{schedule.deposit.amount}}." },
  ],
  paymentSchedule: { items: [{ key: "deposit", label: "Deposit", percent: 50, trigger: "on signing" }, { key: "final", label: "Final", percent: 50, trigger: "on completion" }] },
  paymentScheduleText: "Pay as follows:",
  consentText: "I agree to sign electronically.",
};

describe("validateTemplateContent", () => {
  it("accepts a well-formed template", () => {
    expect(validateTemplateContent(good)).toEqual([]);
  });

  it("names every problem", () => {
    const errs = validateTemplateContent({
      title: " ",
      articles: [
        { key: "Bad Key", title: "", body: "" },
        { key: "parties", title: "A", body: "{{nope}} and {{schedule.retainage.amount}}" },
        { key: "parties", title: "B", body: "dup" },
      ],
      paymentSchedule: { items: [{ key: "deposit", label: "Deposit", percent: 60, trigger: "" }] },
      paymentScheduleText: "",
      consentText: "",
    });
    const all = errs.join("\n");
    expect(all).toMatch(/Title is required/);
    expect(all).toMatch(/Article 1: title is required/);
    expect(all).toMatch(/key must be lowercase/);
    expect(all).toMatch(/duplicate key "parties"/);
    expect(all).toMatch(/body is required/);
    expect(all).toMatch(/Payment schedule: Percents add up to 60%/);
    expect(all).toMatch(/Consent text is required/);
    expect(all).toMatch(/Unknown merge fields: \{\{nope\}\}, \{\{schedule\.retainage\.amount\}\}/);
  });
});

describe("templateContentHash", () => {
  it("ignores whitespace and line-ending noise but not wording", () => {
    const a = templateContentHash(good);
    const b = templateContentHash({ ...good, title: "  Agreement ", articles: good.articles.map((x) => ({ ...x, body: `${x.body.replace(/\n/g, "\r\n")}  ` })) });
    const c = templateContentHash({ ...good, articles: [{ ...good.articles[0], body: "Changed." }, good.articles[1]] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the schedule changes", () => {
    const c = templateContentHash({ ...good, paymentSchedule: { items: [{ key: "all", label: "All", percent: 100, trigger: "" }] } });
    expect(c).not.toBe(templateContentHash(good));
  });
});

describe("parseTemplateContent", () => {
  it("tolerates missing or malformed JSON columns", () => {
    expect(parseTemplateContent({ title: "T", articles: null, paymentSchedule: "nope", paymentScheduleText: "", consentText: "" })).toEqual({
      title: "T",
      articles: [],
      paymentSchedule: { items: [] },
      paymentScheduleText: "",
      consentText: "",
    });
  });
  it("round-trips real content", () => {
    expect(parseTemplateContent({ ...good, paymentSchedule: good.paymentSchedule, articles: good.articles })).toEqual(good);
  });
});
