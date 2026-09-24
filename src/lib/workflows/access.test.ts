import { describe, expect, it } from "vitest";
import {
  canApplyWorkflow,
  canCoordinateWorkflow,
  canManageTemplates,
  canOverrideBlockingGate,
  canSetPermitStatus,
  canViewTemplates,
  isOnJobTeam,
} from "./access";
import type { RoleName } from "@/generated/prisma/client";

const ALL: RoleName[] = ["ADMIN", "MANAGER", "SALES_REP", "OFFICE_STAFF", "MARKETING", "READ_ONLY", "CREW_LEAD"];
const job = { projectManagerId: "pm", teamUserIds: ["sup"], fieldUserIds: ["frank"] };

describe("workflow permissions", () => {
  it("apply/reconcile and blocking-gate overrides are ADMIN and MANAGER only", () => {
    expect(ALL.filter(canApplyWorkflow)).toEqual(["ADMIN", "MANAGER"]);
    expect(ALL.filter((r) => canOverrideBlockingGate(r))).toEqual(["ADMIN", "MANAGER"]);
    expect(canOverrideBlockingGate(null)).toBe(false);
  });

  it("templates: office roles view, only ADMIN manages", () => {
    expect(ALL.filter(canViewTemplates)).toEqual(["ADMIN", "MANAGER", "OFFICE_STAFF"]);
    expect(ALL.filter(canManageTemplates)).toEqual(["ADMIN"]);
  });

  it("the job's PM gets permit and coordination rights by relationship, not role", () => {
    const pm = { id: "pm", role: "SALES_REP" as RoleName };
    const other = { id: "x", role: "SALES_REP" as RoleName };
    expect(canSetPermitStatus(pm, job)).toBe(true);
    expect(canSetPermitStatus(other, job)).toBe(false);
    expect(canCoordinateWorkflow(pm, job)).toBe(true);
    expect(canCoordinateWorkflow({ id: "x", role: "OFFICE_STAFF" }, job)).toBe(true);
    expect(canCoordinateWorkflow(other, job)).toBe(false);
    // A PM never gets to skip a blocking gate on the strength of being PM.
    expect(canOverrideBlockingGate(pm.role)).toBe(false);
  });

  it("team membership covers PM, team slots and field assignment", () => {
    expect(isOnJobTeam({ id: "pm", role: "SALES_REP" }, job)).toBe(true);
    expect(isOnJobTeam({ id: "sup", role: "CREW_LEAD" }, job)).toBe(true);
    expect(isOnJobTeam({ id: "frank", role: "CREW_LEAD" }, job)).toBe(true);
    expect(isOnJobTeam({ id: "nobody", role: "CREW_LEAD" }, job)).toBe(false);
  });
});

describe("workflow reports access", () => {
  it("office roles and read-only see the report; own-only roles do not", async () => {
    const { canViewWorkflowReports, workflowHealthScope } = await import("./access");
    expect(canViewWorkflowReports("ADMIN")).toBe(true);
    expect(canViewWorkflowReports("MANAGER")).toBe(true);
    expect(canViewWorkflowReports("OFFICE_STAFF")).toBe(true);
    expect(canViewWorkflowReports("READ_ONLY")).toBe(true);
    expect(canViewWorkflowReports("SALES_REP")).toBe(false);
    expect(canViewWorkflowReports("CREW_LEAD")).toBe(false);
    expect(canViewWorkflowReports("MARKETING")).toBe(false);
    expect(workflowHealthScope({ id: "u", role: "OFFICE_STAFF" })).toBe("all");
    expect(workflowHealthScope({ id: "u", role: "SALES_REP" })).toBe("own");
  });
});
