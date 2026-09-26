import { describe, expect, it } from "vitest";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "@/lib/jobs/involvement";
import { toSearchHits } from "./format";
import { buildSearchWheres } from "./query";

const now = new Date("2026-09-25T12:00:00Z");
const admin = { user: { id: "adm", role: "ADMIN" as const }, now };
const rep = { user: { id: "rep", role: "SALES_REP" as const }, now };

describe("buildSearchWheres", () => {
  it("an office role searches everything without a scope fragment", () => {
    const w = buildSearchWheres("wind", admin);
    expect(JSON.stringify(w.jobs)).not.toContain(JSON.stringify(jobsInvolvingUserWhere("adm")));
    expect(JSON.stringify(w.jobs)).toContain('"propertyAddress1"');
    expect(JSON.stringify(w.leads)).toContain('"propertyAddress1"');
    expect(w.prospects).toEqual({ AND: [{}, { OR: expect.any(Array) }] });
  });

  it("a sales rep gets the same floors as the list pages", () => {
    const w = buildSearchWheres("wind", rep);
    expect(JSON.stringify(w.jobs)).toContain(JSON.stringify(jobsInvolvingUserWhere("rep")));
    expect(JSON.stringify(w.leads)).toContain(JSON.stringify(leadsInvolvingUserWhere("rep")));
    // Cases: the visibility filter is the last AND entry.
    const and = (w.cases as { AND: unknown[] }).AND;
    expect(and[and.length - 1]).toEqual({ OR: expect.arrayContaining([{ caseManagerId: "rep" }]) });
    expect(w.prospects).toEqual({ AND: [{ assignedToUserId: "rep" }, { OR: expect.any(Array) }] });
  });

  it("leads include closed ones — a won lead is still findable", () => {
    const w = buildSearchWheres("smith", admin);
    expect(JSON.stringify(w.leads)).not.toContain('"isClosed":false');
  });
});

describe("toSearchHits", () => {
  const lead = { fullName: "Sarah Smith", propertyAddress1: "12 Palm Ct", propertyAddress2: null, city: "Miami" };
  it("names every kind by its address and links to the record", () => {
    const hits = toSearchHits({
      jobs: [{ id: "j1", jobNumber: "JOB-00005", title: "t", serviceType: "Roofing", lead, currentStage: { name: "In Progress" } }],
      leads: [{ id: "l1", ...lead, primaryPhone: "555", currentStage: { name: "New" } }],
      cases: [{ id: "c1", caseNumber: "CV-00001", title: "Deck", lead, status: "ACTIVE" }],
      prospects: [{ id: "p1", propertyAddress1: "9 Elm", city: "Miami", ownerName: "Pat" }],
    });
    expect(hits).toEqual([
      { type: "job", id: "j1", primary: "12 Palm Ct, Miami", secondary: "Sarah Smith · Roofing · In Progress", code: "JOB-00005", href: "/jobs/j1" },
      { type: "lead", id: "l1", primary: "12 Palm Ct, Miami", secondary: "Sarah Smith · 555 · New", code: null, href: "/leads/l1" },
      { type: "case", id: "c1", primary: "12 Palm Ct, Miami", secondary: "Sarah Smith · Deck · ACTIVE", code: "CV-00001", href: "/violations/c1" },
      { type: "prospect", id: "p1", primary: "9 Elm, Miami", secondary: "Pat", code: null, href: "/canvassing/prospects?search=9%20Elm" },
    ]);
  });
  it("a lead with a placeholder street falls back to the name", () => {
    expect(toSearchHits({ jobs: [], leads: [{ id: "l", fullName: "Pat Doe", propertyAddress1: "TBD", city: "Miami" }], cases: [], prospects: [] })[0]).toMatchObject({ primary: "Pat Doe", secondary: null });
  });
});
