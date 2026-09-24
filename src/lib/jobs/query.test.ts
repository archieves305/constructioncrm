import { describe, expect, it } from "vitest";
import { buildJobListWhere, hasWorkflowFilter, parseJobListParams } from "./query";

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
    });
    expect(parseJobListParams(new URLSearchParams("permitStatus=bogus")).permitStatus).toBeUndefined();
    expect(parseJobListParams(new URLSearchParams("permitStatus=NONE")).permitStatus).toBe("NONE");
  });
});

describe("buildJobListWhere", () => {
  it("is empty with no filters for a full-access role", () => {
    expect(buildJobListWhere({}, admin)).toEqual({});
  });

  it("keeps the classic filters and the sales-rep scope", () => {
    const where = buildJobListWhere({ stageId: "s1", search: "smith" }, { user: { id: "rep", role: "SALES_REP" }, now });
    expect(where).toEqual({
      AND: [
        { currentStageId: "s1" },
        { OR: expect.arrayContaining([{ jobNumber: { contains: "smith", mode: "insensitive" } }]) },
        { salesRepId: "rep" },
      ],
    });
  });

  it("a sales rep cannot widen the scope with salesRepId", () => {
    const where = buildJobListWhere({ salesRepId: "someone-else" }, { user: { id: "rep", role: "SALES_REP" }, now });
    expect(where).toEqual({ AND: [{ salesRepId: "someone-else" }, { salesRepId: "rep" }] });
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
              workflowTaskKey: { not: null },
              status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
              activatedAt: { not: null },
              dueAt: { lt: now },
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
