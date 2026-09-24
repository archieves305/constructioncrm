import { describe, expect, it } from "vitest";
import { resolveAssignee, unassignedRoles, type RoleContext } from "./roles";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn() } }));
import { vi } from "vitest";

const ctx: RoleContext = {
  team: { SUPERINTENDENT: "u-sup" },
  projectManagerId: "u-pm",
  salesRepId: null,
  defaults: { ACCOUNTING: "u-acc", SUPERINTENDENT: "u-default-sup" },
};

describe("resolveAssignee", () => {
  it("prefers the team slot, then the job's own fields, then the company default", () => {
    expect(resolveAssignee("SUPERINTENDENT", ctx)).toBe("u-sup");
    expect(resolveAssignee("PROJECT_MANAGER", ctx)).toBe("u-pm");
    expect(resolveAssignee("ACCOUNTING", ctx)).toBe("u-acc");
    expect(resolveAssignee("SALES_REP", ctx)).toBeNull();
    expect(resolveAssignee("PERMIT_COORDINATOR", ctx)).toBeNull();
  });

  it("lists the roles a plan uses that resolve to nobody, in a stable order", () => {
    expect(unassignedRoles(["ACCOUNTING", "PERMIT_COORDINATOR", "SALES_REP", "SUPERINTENDENT"], ctx)).toEqual([
      "PERMIT_COORDINATOR",
      "SALES_REP",
    ]);
  });
});
