import { describe, expect, it } from "vitest";
import { formatAddressFull, formatAddressLine, isPlaceholderAddress } from "./address";
import { caseLabel, caseText } from "./case";
import { jobLabel, jobText, jobTextWithCustomer } from "./job";
import { subjectLabel, subjectText } from "./subject";

const navarre = { fullName: "Carey Real Estate Holdings, LLC", companyName: null, propertyAddress1: "2192 Wind Trace", propertyAddress2: null, city: "Navarre", state: "FL", zipCode: "32566" };
const tbd = { ...navarre, propertyAddress1: "2188 (street TBD)" };
const job5 = { id: "j5", jobNumber: "JOB-00005", title: "2192 Wind Trace — New Construction (Navarre)", serviceType: "New Construction", lead: navarre };
const job4 = { id: "j4", jobNumber: "JOB-00004", title: "2188 — New Construction (Navarre)", serviceType: "New Construction", lead: tbd };

describe("isPlaceholderAddress", () => {
  it.each(["", "  ", "TBD", "tba", "n/a", "Unknown", "pending", "-"])("treats %j as a placeholder", (s) => {
    expect(isPlaceholderAddress(s)).toBe(true);
  });
  it.each(["2188 (street TBD)", "12 Main St", "TBD Lane"])("keeps %j", (s) => {
    expect(isPlaceholderAddress(s)).toBe(false);
  });
});

describe("formatAddressLine / formatAddressFull", () => {
  it("joins street, unit and city; skips what is missing", () => {
    expect(formatAddressLine({ propertyAddress1: "12 Main St" })).toBe("12 Main St");
    expect(formatAddressLine({ propertyAddress1: "12 Main St", propertyAddress2: "Ste 102" })).toBe("12 Main St, Ste 102");
    expect(formatAddressLine({ propertyAddress1: "12 Main St", city: "Miami" })).toBe("12 Main St, Miami");
    expect(formatAddressLine({ propertyAddress1: " 12  Main St ", propertyAddress2: "Ste 102", city: "Miami" })).toBe("12 Main St, Ste 102, Miami");
  });
  it("is empty for null or a placeholder street, whatever the city says", () => {
    expect(formatAddressLine(null)).toBe("");
    expect(formatAddressLine({ propertyAddress1: "TBD", city: "Miami" })).toBe("");
  });
  it("full form adds state and zip", () => {
    expect(formatAddressFull(navarre)).toBe("2192 Wind Trace, Navarre, FL 32566");
    expect(formatAddressFull({ ...navarre, zipCode: null })).toBe("2192 Wind Trace, Navarre, FL");
    expect(formatAddressFull({ propertyAddress1: "TBD" })).toBe("");
  });
});

describe("jobLabel", () => {
  it("leads with the address, customer and trade under it, number as the code", () => {
    expect(jobLabel(job5)).toEqual({ primary: "2192 Wind Trace, Navarre", secondary: "Carey Real Estate Holdings, LLC · New Construction", code: "JOB-00005", placeholder: false });
  });
  it("drops the customer or the trade on request", () => {
    expect(jobLabel(job5, { customer: false }).secondary).toBe("New Construction");
    expect(jobLabel(job5, { trade: false }).secondary).toBe("Carey Real Estate Holdings, LLC");
    expect(jobLabel(job5, { customer: false, trade: false }).secondary).toBeNull();
  });
  it("keeps a typed street with a TBD note — it still tells same-customer jobs apart", () => {
    expect(jobLabel(job4).primary).toBe("2188 (street TBD), Navarre");
    expect(jobLabel(job4).primary).not.toBe(jobLabel(job5).primary);
  });
  it("falls back to the title, then the number", () => {
    expect(jobLabel({ jobNumber: "JOB-1", title: "Roofing — Smith", lead: null })).toEqual({ primary: "Roofing — Smith", secondary: null, code: "JOB-1", placeholder: true });
    expect(jobLabel({ jobNumber: "JOB-1", title: "", lead: { propertyAddress1: "TBD", fullName: "Smith" } })).toEqual({ primary: "JOB-1", secondary: "Smith", code: null, placeholder: true });
  });
  it("uses the company name when there is no person", () => {
    expect(jobLabel({ jobNumber: "JOB-1", lead: { ...navarre, fullName: "", companyName: "Acme" } }).secondary).toBe("Acme");
  });
});

describe("jobText", () => {
  it("is address (number), title (number), or number alone", () => {
    expect(jobText(job5)).toBe("2192 Wind Trace, Navarre (JOB-00005)");
    expect(jobText({ jobNumber: "JOB-1", title: "Roofing — Smith" })).toBe("Roofing — Smith (JOB-1)");
    expect(jobText({ jobNumber: "JOB-1" })).toBe("JOB-1");
  });
  it("with customer", () => {
    expect(jobTextWithCustomer(job5)).toBe("2192 Wind Trace, Navarre — Carey Real Estate Holdings, LLC (JOB-00005)");
    expect(jobTextWithCustomer({ jobNumber: "JOB-1" })).toBe("JOB-1");
  });
});

describe("caseLabel / caseText", () => {
  it("leads with the property, owner and title under it", () => {
    expect(caseLabel({ caseNumber: "CV-00003", title: "Unpermitted deck", lead: navarre })).toEqual({
      primary: "2192 Wind Trace, Navarre",
      secondary: "Carey Real Estate Holdings, LLC · Unpermitted deck",
      code: "CV-00003",
      placeholder: false,
    });
    expect(caseText({ caseNumber: "CV-00003", lead: navarre })).toBe("2192 Wind Trace, Navarre (CV-00003)");
    expect(caseText({ caseNumber: "CV-00003", title: "", lead: null })).toBe("CV-00003");
  });
});

describe("subjectLabel", () => {
  const lead = { id: "l1", ...navarre };
  const base = { job: job5, lead };

  it("a violation step goes to the case (and item), address first", () => {
    const s = subjectLabel({ ...base, violationCase: { id: "c1", caseNumber: "CV-00001" }, violationItem: { id: "i2", itemNumber: 2 } });
    expect(s).toEqual({ kind: "violation", href: "/violations/c1?tab=items&item=i2", primary: "2192 Wind Trace, Navarre", secondary: "Item 2", code: "CV-00001", placeholder: false });
    expect(subjectLabel({ lead, violationCase: { id: "c1", caseNumber: "CV-00001" } })?.href).toBe("/violations/c1");
  });
  it("an invoice beats the job; a daily log links to its date", () => {
    const inv = subjectLabel({ ...base, invoice: { id: "inv", invoiceNumber: "INV-00012", jobId: "j5" } });
    expect(inv).toMatchObject({ kind: "invoice", href: "/jobs/j5", primary: "2192 Wind Trace, Navarre", code: "INV-00012" });
    const log = subjectLabel({ ...base, dailyLog: { id: "d", jobId: "j5", logDate: "2026-09-24T00:00:00.000Z" } });
    expect(log).toMatchObject({ kind: "dailyLog", href: "/jobs/j5/daily-logs/2026-09-24", primary: "2192 Wind Trace, Navarre", secondary: "Log · Sep 24", code: "JOB-00005" });
    expect(subjectLabel({ ...base, dailyLog: { id: "d", jobId: "j5", logDate: new Date("2026-09-24T15:00:00Z") } })?.secondary).toBe("Log · Sep 24");
  });
  it("an invoice without its job degrades to the number", () => {
    expect(subjectLabel({ invoice: { id: "inv", invoiceNumber: "INV-1", jobId: "j" } })).toMatchObject({ primary: "INV-1", code: null, placeholder: true });
  });
  it("estimate, prospect, job and lead", () => {
    expect(subjectLabel({ lead, estimate: { id: "e", estimateNumber: "EST-7", name: "Roof", leadId: "l1" } })).toMatchObject({ kind: "estimate", href: "/leads/l1", primary: "2192 Wind Trace, Navarre", secondary: "Roof", code: "EST-7" });
    expect(subjectLabel({ prospect: { id: "p", propertyAddress1: "9 Elm", city: "Miami" } })).toMatchObject({ kind: "prospect", href: "/canvassing/prospects", primary: "9 Elm, Miami" });
    expect(subjectLabel({ job: job5 })).toMatchObject({ kind: "job", href: "/jobs/j5", primary: "2192 Wind Trace, Navarre", code: "JOB-00005" });
    expect(subjectLabel({ lead })).toMatchObject({ kind: "lead", href: "/leads/l1", primary: "2192 Wind Trace, Navarre", secondary: "Carey Real Estate Holdings, LLC" });
    expect(subjectLabel({ lead: { id: "l2", fullName: "Pat Doe", propertyAddress1: "TBD" } })).toMatchObject({ primary: "Pat Doe", placeholder: true });
    expect(subjectLabel({})).toBeNull();
  });
});

describe("subjectText", () => {
  const lead = { id: "l1", ...navarre, fullName: "Sarah Smith" };
  it("reads as one line per kind", () => {
    expect(subjectText({ job: job5 })).toBe("2192 Wind Trace, Navarre — Carey Real Estate Holdings, LLC (JOB-00005)");
    expect(subjectText({ job: job5, invoice: { id: "i", invoiceNumber: "INV-00012", jobId: "j5" } })).toBe("INV-00012 — 2192 Wind Trace, Navarre (JOB-00005)");
    expect(subjectText({ job: job5, dailyLog: { id: "d", jobId: "j5", logDate: "2026-09-24" } })).toBe("Daily log Sep 24 — 2192 Wind Trace, Navarre (JOB-00005)");
    expect(subjectText({ lead, violationCase: { id: "c", caseNumber: "CV-00001" } })).toBe("CV-00001 — 2192 Wind Trace, Navarre");
    expect(subjectText({ lead, estimate: { id: "e", estimateNumber: "EST-7", name: "Roof", leadId: "l1" } })).toBe("EST-7 · Roof — 2192 Wind Trace, Navarre");
    expect(subjectText({ lead })).toBe("Sarah Smith — 2192 Wind Trace, Navarre");
    expect(subjectText({})).toBe("");
  });
});
