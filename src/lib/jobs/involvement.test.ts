import { describe, expect, it } from "vitest";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "./involvement";

describe("jobsInvolvingUserWhere", () => {
  it("is an OR over every way a user can hold a role on a job, with no id lists", () => {
    const w = jobsInvolvingUserWhere("u1");
    expect(w.OR).toHaveLength(8);
    expect(w.OR).toEqual(
      expect.arrayContaining([
        { salesRepId: "u1" },
        { projectManagerId: "u1" },
        { workflow: { team: { some: { userId: "u1" } } } },
        { fieldAssignments: { some: { userId: "u1" } } },
        { crewAssignments: { some: { crew: { members: { some: { userId: "u1" } } } } } },
        { laborContracts: { some: { crew: { members: { some: { userId: "u1" } } } } } },
        { personnelScopes: { some: { personnel: { userId: "u1" } } } },
        // A role filled from the company defaults has no team slot; owning an open step is the role.
        { tasks: { some: { assignedUserId: "u1", workflowTaskKey: { not: null }, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } } } },
      ]),
    );
    // No lists of record ids — the only `in` is the fixed set of open statuses.
    expect(JSON.stringify(w)).not.toMatch(/[iI]d":\{"in"/);
  });
});

describe("leadsInvolvingUserWhere", () => {
  it("is assigned-to-me or the customer of a job I am on", () => {
    expect(leadsInvolvingUserWhere("u1")).toEqual({
      OR: [{ assignedUserId: "u1" }, { jobs: { some: jobsInvolvingUserWhere("u1") } }],
    });
  });
});
