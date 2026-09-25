import { describe, expect, it } from "vitest";
import { jobsInvolvingUserWhere, leadsInvolvingUserWhere } from "./involvement";

describe("jobsInvolvingUserWhere", () => {
  it("is an OR over every way a user can hold a role on a job, with no id lists", () => {
    const w = jobsInvolvingUserWhere("u1");
    expect(w.OR).toHaveLength(7);
    expect(w.OR).toEqual(
      expect.arrayContaining([
        { salesRepId: "u1" },
        { projectManagerId: "u1" },
        { workflow: { team: { some: { userId: "u1" } } } },
        { fieldAssignments: { some: { userId: "u1" } } },
        { crewAssignments: { some: { crew: { members: { some: { userId: "u1" } } } } } },
        { laborContracts: { some: { crew: { members: { some: { userId: "u1" } } } } } },
        { personnelScopes: { some: { personnel: { userId: "u1" } } } },
      ]),
    );
    expect(JSON.stringify(w)).not.toMatch(/"in"/);
  });
});

describe("leadsInvolvingUserWhere", () => {
  it("is assigned-to-me or the customer of a job I am on", () => {
    expect(leadsInvolvingUserWhere("u1")).toEqual({
      OR: [{ assignedUserId: "u1" }, { jobs: { some: jobsInvolvingUserWhere("u1") } }],
    });
  });
});
