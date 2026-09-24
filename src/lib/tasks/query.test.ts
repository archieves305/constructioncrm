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
