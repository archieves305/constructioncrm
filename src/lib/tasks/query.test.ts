import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import { buildTaskListWhere, readTaskListParams } from "./query";

const admin = { id: "admin-1", role: "ADMIN" as const };
const rep = { id: "rep-1", role: "SALES_REP" as const };

function whereOf(qs: string, user: { id: string; role: RoleName } = admin) {
  const w = buildTaskListWhere(readTaskListParams(new URLSearchParams(qs)), user);
  const [filters, scope] = w.AND as [Record<string, unknown>, Record<string, unknown>];
  return { filters, scope };
}

describe("buildTaskListWhere", () => {
  it("shows every open status by default, BLOCKED included", () => {
    const { filters } = whereOf("");
    expect(filters.status).toEqual({ in: ["PENDING", "IN_PROGRESS", "BLOCKED"] });
  });

  it("drops the status filter when completed tasks are requested", () => {
    const { filters } = whereOf("includeCompleted=true");
    expect(filters.status).toBeUndefined();
  });

  it("an explicit status wins over the default", () => {
    const { filters } = whereOf("status=COMPLETED");
    expect(filters.status).toBe("COMPLETED");
  });

  it("overdue means open and past due, and accepts 1 as well as true", () => {
    for (const v of ["true", "1"]) {
      const { filters } = whereOf(`overdue=${v}`);
      expect(filters.status).toEqual({ in: ["PENDING", "IN_PROGRESS", "BLOCKED"] });
      expect((filters.dueAt as { lt: Date }).lt).toBeInstanceOf(Date);
    }
  });

  it("resolves assignedUserId=me to the caller", () => {
    const { filters } = whereOf("assignedUserId=me", rep);
    expect(filters.assignedUserId).toBe("rep-1");
  });

  it("passes every entity link through", () => {
    const { filters } = whereOf(
      "leadId=l&jobId=j&estimateId=e&invoiceId=i&prospectId=p&dailyLogId=d",
    );
    expect(filters).toMatchObject({
      leadId: "l",
      jobId: "j",
      estimateId: "e",
      invoiceId: "i",
      prospectId: "p",
      dailyLogId: "d",
    });
  });

  it("always ANDs the role scope: a rep on a job page sees only their own rows", () => {
    const { scope } = whereOf("jobId=j", rep);
    expect(scope).toEqual({ OR: [{ assignedUserId: "rep-1" }, { createdByUserId: "rep-1" }] });
  });

  it("an office role gets an empty scope", () => {
    const { scope } = whereOf("jobId=j", admin);
    expect(scope).toEqual({});
  });
});

describe("buildTaskListWhere — workflow filters", () => {
  const rep = { id: "u-rep", role: "SALES_REP" as const };
  const office = { id: "u-office", role: "OFFICE_STAFF" as const };
  type U = { id: string; role: RoleName };
  const w = (qs: string, user: U = office, scope?: { jobIds: string[] }) =>
    buildTaskListWhere(readTaskListParams(new URLSearchParams(qs)), user, new Date("2026-10-01T12:00:00Z"), scope);
  const first = (qs: string, user: U = office, scope?: { jobIds: string[] }) => (w(qs, user, scope).AND as Record<string, unknown>[])[0]!;

  it("hides Not-active steps by default and shows them with includeInactive", () => {
    expect(first("")).toMatchObject({ activatedAt: { not: null } });
    expect(first("includeInactive=1")).not.toHaveProperty("activatedAt");
    expect(first("status=PENDING")).toMatchObject({ status: "PENDING", activatedAt: { not: null } });
    expect(first("status=PENDING&includeInactive=1")).toEqual({ status: "PENDING" });
  });

  it("ready / waiting / blocked are exclusive shortcuts", () => {
    expect(first("ready=1")).toEqual({ status: "PENDING", activatedAt: { not: null } });
    expect(first("waiting=1")).toEqual({ status: "PENDING", activatedAt: null });
    expect(first("blocked=1")).toEqual({ status: "BLOCKED" });
  });

  it("source, instance, phase and module narrow the list", () => {
    expect(first("source=manual")).toMatchObject({ workflowTaskKey: null });
    expect(first("source=workflow")).toMatchObject({ workflowTaskKey: { not: null } });
    expect(first("source=bogus")).not.toHaveProperty("workflowTaskKey");
    expect(first("workflowInstanceId=w1&phaseKey=core:setup&moduleKey=core")).toMatchObject({
      workflowInstanceId: "w1",
      workflowPhaseKey: "core:setup",
      workflowModuleKey: "core",
    });
  });

  it("an own-only role's scope widens to the jobs they are on", () => {
    const vis = (w("", rep, { jobIds: ["j1", "j2"] }).AND as Record<string, unknown>[])[1]!;
    expect(vis).toEqual({
      OR: [{ assignedUserId: "u-rep" }, { createdByUserId: "u-rep" }, { jobId: { in: ["j1", "j2"] } }],
    });
    // An empty scope adds nothing, and office roles never get one.
    expect((w("", rep, { jobIds: [] }).AND as Record<string, unknown>[])[1]).toEqual({
      OR: [{ assignedUserId: "u-rep" }, { createdByUserId: "u-rep" }],
    });
    expect((w("", office, { jobIds: ["j1"] }).AND as Record<string, unknown>[])[1]).toEqual({});
  });
});
