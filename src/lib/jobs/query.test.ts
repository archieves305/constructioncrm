import { describe, expect, it } from "vitest";
import { jobsInvolvingUserWhere } from "./involvement";
import { buildJobListWhere, hasWorkflowFilter, parseJobListParams } from "./query";
import { overdueWhere } from "@/lib/calendar/status";

const now = new Date("2026-09-24T12:00:00Z");
const admin = { user: { id: "u-admin", role: "ADMIN" as const }, now };

describe("parseJobListParams", () => {
  it("reads every param and drops unknown permit values", () => {
    const p = parseJobListParams(
      new URLSearchParams("stageId=s1&salesRepId=r1&search=smith&workflowTrade=roofing&permitStatus=REQUIRED&phaseKey=core:job_setup&workflowBlocked=1&workflowOverdue=true&workflowUnassigned=0"),
    );
    expect(p).toEqual({
      stageId: "s1",
      salesRepId: "r1",
      search: "smith",
      workflowTrade: "roofing",
      permitStatus: "REQUIRED",
      phaseKey: "core:job_setup",
      workflowBlocked: true,
      workflowOverdue: true,
      workflowUnassigned: false,
      excludeClosed: false,
    });
    expect(parseJobListParams(new URLSearchParams("excludeClosed=1")).excludeClosed).toBe(true);
    expect(parseJobListParams(new URLSearchParams("permitStatus=bogus")).permitStatus).toBeUndefined();
    expect(parseJobListParams(new URLSearchParams("permitStatus=NONE")).permitStatus).toBe("NONE");
  });
});

describe("buildJobListWhere", () => {
  it("is empty with no filters for a full-access role", () => {
    expect(buildJobListWhere({}, admin)).toEqual({});
  });

  it("keeps the classic filters and floors a sales rep to the jobs they are on", () => {
    const where = buildJobListWhere({ stageId: "s1", search: "smith" }, { user: { id: "rep", role: "SALES_REP" }, now });
    expect(where).toEqual({
      AND: [
        { currentStageId: "s1" },
        {
          OR: [
            { jobNumber: { contains: "smith", mode: "insensitive" } },
            { title: { contains: "smith", mode: "insensitive" } },
            { permits: { some: { permitNumber: { contains: "smith", mode: "insensitive" } } } },
            { invoices: { some: { invoiceNumber: { contains: "smith", mode: "insensitive" } } } },
            {
              lead: {
                OR: [
                  { fullName: { contains: "smith", mode: "insensitive" } },
                  { companyName: { contains: "smith", mode: "insensitive" } },
                  { propertyAddress1: { contains: "smith", mode: "insensitive" } },
                  { city: { contains: "smith", mode: "insensitive" } },
                  { zipCode: { contains: "smith" } },
                  { primaryPhone: { contains: "smith" } },
                ],
              },
            },
          ],
        },
        jobsInvolvingUserWhere("rep"),
      ],
    });
  });

  it("finds a job by an invoice number or a permit number", () => {
    const w = JSON.stringify(buildJobListWhere({ search: "INV-00006" }, { user: { id: "a", role: "ADMIN" }, now }));
    expect(w).toContain('"invoices":{"some":{"invoiceNumber"');
    expect(w).toContain('"permits":{"some":{"permitNumber"');
  });

  it("search reaches the property: address, city, zip and phone live on the lead", () => {
    const where = buildJobListWhere({ search: "wind" }, admin);
    const leadOr = (where.OR as { lead?: { OR: Record<string, unknown>[] } }[]).find((o) => o.lead)!.lead!.OR;
    expect(leadOr.map((o) => Object.keys(o)[0])).toEqual(["fullName", "companyName", "propertyAddress1", "city", "zipCode", "primaryPhone"]);
  });

  it("search finds a job by a permit number on it", () => {
    const where = buildJobListWhere({ search: "BLD-24" }, admin);
    expect(where.OR).toContainEqual({ permits: { some: { permitNumber: { contains: "BLD-24", mode: "insensitive" } } } });
  });

  it("a sales rep cannot widen the scope with salesRepId or scope=all", () => {
    const where = buildJobListWhere({ salesRepId: "someone-else", scope: "all" }, { user: { id: "rep", role: "SALES_REP" }, now });
    expect(where).toEqual({ AND: [{ salesRepId: "someone-else" }, jobsInvolvingUserWhere("rep")] });
  });

  it("an office role chooses: scope=all adds nothing, scope=mine adds involvement", () => {
    expect(buildJobListWhere({ scope: "all" }, { user: { id: "adm", role: "ADMIN" }, now })).toEqual({});
    expect(buildJobListWhere({ scope: "mine" }, { user: { id: "adm", role: "ADMIN" }, now })).toEqual(jobsInvolvingUserWhere("adm"));
  });

  it("involvesUserId and serviceType are ordinary AND filters", () => {
    const where = buildJobListWhere({ involvesUserId: "pm", serviceType: "Roofing" }, { user: { id: "adm", role: "ADMIN" }, now });
    expect(where).toEqual({ AND: [jobsInvolvingUserWhere("pm"), { serviceType: "Roofing" }] });
  });

  it("filters by applied trade, ignoring removed modules", () => {
    expect(buildJobListWhere({ workflowTrade: "roofing" }, admin)).toEqual({
      workflow: { modules: { some: { templateKey: "roofing", removedAt: null } } },
    });
  });

  it("permit status filters the instance; NONE means no workflow", () => {
    expect(buildJobListWhere({ permitStatus: "UNDETERMINED" }, admin)).toEqual({ workflow: { permitStatus: "UNDETERMINED" } });
    expect(buildJobListWhere({ permitStatus: "NONE" }, admin)).toEqual({ workflow: { is: null } });
  });

  it("phase means active open work in that phase", () => {
    expect(buildJobListWhere({ phaseKey: "roofing:permitting" }, admin)).toEqual({
      tasks: {
        some: {
          workflowTaskKey: { not: null },
          status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
          activatedAt: { not: null },
          workflowPhaseKey: "roofing:permitting",
        },
      },
    });
  });

  it("blocked / overdue / unassigned look only at workflow steps, and overdue/unassigned only at active ones", () => {
    const where = buildJobListWhere({ workflowBlocked: true, workflowOverdue: true, workflowUnassigned: true }, admin);
    expect(where).toEqual({
      AND: [
        { tasks: { some: { workflowTaskKey: { not: null }, status: "BLOCKED" } } },
        {
          tasks: {
            some: {
              AND: [
                {
                  workflowTaskKey: { not: null },
                  status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
                  activatedAt: { not: null },
                },
                // The one overdue rule: past the end of its day (all-day) or past its end (timed).
                overdueWhere(now),
              ],
            },
          },
        },
        {
          tasks: {
            some: {
              workflowTaskKey: { not: null },
              status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
              activatedAt: { not: null },
              assignedUserId: null,
            },
          },
        },
      ],
    });
  });

  it("excludeClosed hides closed stages unless a stage or a search says otherwise", () => {
    expect(buildJobListWhere({ excludeClosed: true }, admin)).toEqual({ currentStage: { isClosed: false } });
    expect(buildJobListWhere({ excludeClosed: true, stageId: "s-closed" }, admin)).toEqual({ currentStageId: "s-closed" });
    expect(buildJobListWhere({ excludeClosed: true, search: "main st" }, admin)).not.toHaveProperty("currentStage");
    expect(JSON.stringify(buildJobListWhere({ excludeClosed: true, search: "main st" }, admin))).not.toContain("isClosed");
    expect(buildJobListWhere({ excludeClosed: false }, admin)).toEqual({});
  });

  it("false flags add nothing", () => {
    expect(buildJobListWhere({ workflowBlocked: false, workflowOverdue: false, workflowUnassigned: false }, admin)).toEqual({});
  });
});

describe("hasWorkflowFilter", () => {
  it("is true only for workflow params", () => {
    expect(hasWorkflowFilter({ stageId: "x", search: "y" })).toBe(false);
    expect(hasWorkflowFilter({ workflowOverdue: true })).toBe(true);
    expect(hasWorkflowFilter({ permitStatus: "NONE" })).toBe(true);
  });
});
