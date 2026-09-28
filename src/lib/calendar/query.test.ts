import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { taskVisibilityFilter } from "@/lib/tasks/access";
import { coerceUsersParam } from "./access";
import { buildCalendarWhere, buildUnscheduledWhere, readCalendarParams, readUnscheduledParams, usersClause } from "./query";

const admin = { id: "adm-1", role: "ADMIN" as const };
const rep = { id: "rep-1", role: "SALES_REP" as const };
const TZ = "America/New_York";

function params(qs: string) {
  const r = readCalendarParams(new URLSearchParams(qs));
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

function andOf(where: Prisma.TaskWhereInput): Prisma.TaskWhereInput[] {
  return where.AND as Prisma.TaskWhereInput[];
}

describe("readCalendarParams", () => {
  it("needs valid day keys in order and within 62 days", () => {
    expect(readCalendarParams(new URLSearchParams("from=2026-09-28")).ok).toBe(false);
    expect(readCalendarParams(new URLSearchParams("from=2026-13-01&to=2026-09-30")).ok).toBe(false);
    expect(readCalendarParams(new URLSearchParams("from=2026-10-04&to=2026-09-28")).ok).toBe(false);
    expect(readCalendarParams(new URLSearchParams("from=2026-09-01&to=2026-11-15")).ok).toBe(false);
    expect(readCalendarParams(new URLSearchParams("from=2026-09-28&to=2026-11-08")).ok).toBe(true); // 42-day month grid
  });
  it("parses csv enums, dropping junk, and the flags", () => {
    const p = params("from=2026-09-28&to=2026-10-04&status=BLOCKED,IN_PROGRESS,nope&priority=HIGH,HIGH&q=%20shingles%20&includeCompleted=1&jobId=j1&users=all");
    expect(p.status).toEqual(["BLOCKED", "IN_PROGRESS"]);
    expect(p.priority).toEqual(["HIGH"]);
    expect(p.q).toBe("shingles");
    expect(p.includeCompleted).toBe(true);
    expect(p.jobId).toBe("j1");
    expect(p.users).toBe("all");
    expect(params("from=2026-09-28&to=2026-10-04&status=nope").status).toBeUndefined();
  });
});

describe("buildCalendarWhere", () => {
  const week = "from=2026-09-28&to=2026-10-04";

  it("selects items whose span touches the range, in the office's zone", () => {
    const and = andOf(buildCalendarWhere(params(week), { kind: "all" }, admin, undefined, TZ));
    expect(and[0]).toEqual({ dueAt: { gte: new Date("2026-09-28T04:00:00.000Z") } });
    expect(and[1]).toEqual({
      OR: [
        { scheduledStart: { lte: new Date("2026-10-05T03:59:59.999Z") } },
        { scheduledStart: null, dueAt: { lte: new Date("2026-10-05T03:59:59.999Z") } },
      ],
    });
    expect(and[2]).toEqual({ activatedAt: { not: null } });
  });

  it("defaults to open statuses; includeCompleted drops the filter; an explicit status wins", () => {
    expect(andOf(buildCalendarWhere(params(week), { kind: "all" }, admin))).toContainEqual({ status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } });
    const all = andOf(buildCalendarWhere(params(`${week}&includeCompleted=1`), { kind: "all" }, admin));
    expect(all.some((c) => "status" in c)).toBe(false);
    expect(andOf(buildCalendarWhere(params(`${week}&status=COMPLETED`), { kind: "all" }, admin))).toContainEqual({ status: { in: ["COMPLETED"] } });
  });

  it("applies the users selection", () => {
    expect(usersClause({ kind: "me" }, admin)).toEqual({ assignedUserId: "adm-1" });
    expect(usersClause({ kind: "all" }, admin)).toEqual({});
    expect(usersClause({ kind: "ids", ids: ["u2"], includeUnassigned: false }, admin)).toEqual({ assignedUserId: { in: ["u2"] } });
    expect(usersClause({ kind: "ids", ids: ["u2", "u3"], includeUnassigned: true }, admin)).toEqual({
      OR: [{ assignedUserId: { in: ["u2", "u3"] } }, { assignedUserId: null }],
    });
    expect(usersClause({ kind: "ids", ids: [], includeUnassigned: true }, admin)).toEqual({ assignedUserId: null });
  });

  it("an own-only role asking for everyone gets themselves, and the visibility filter is always last", () => {
    const sel = coerceUsersParam("all", rep.role);
    const and = andOf(buildCalendarWhere(params(`${week}&users=all`), sel, rep, { jobIds: ["j9"] }));
    expect(and).toContainEqual({ assignedUserId: "rep-1" });
    expect(and[and.length - 1]).toEqual(taskVisibilityFilter(rep, { jobIds: ["j9"] }));
  });

  it("passes job, priority and search through", () => {
    const and = andOf(buildCalendarWhere(params(`${week}&jobId=j1&priority=HIGH,URGENT&q=roof`), { kind: "all" }, admin));
    expect(and).toContainEqual({ jobId: "j1" });
    expect(and).toContainEqual({ priority: { in: ["HIGH", "URGENT"] } });
    expect(and.some((c) => Array.isArray(c.OR) && c.OR.some((o) => "title" in o))).toBe(true);
  });
});

describe("buildUnscheduledWhere", () => {
  it("is active + open + no due date, never an inactive step, scoped to the selection and the role", () => {
    const and = andOf(buildUnscheduledWhere(readUnscheduledParams(new URLSearchParams("users=all&jobId=j1")), { kind: "all" }, admin));
    expect(and[0]).toEqual({ status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, activatedAt: { not: null }, dueAt: null });
    expect(and).toContainEqual({ jobId: "j1" });
    const mine = andOf(buildUnscheduledWhere(readUnscheduledParams(new URLSearchParams("")), coerceUsersParam("all", rep.role), rep));
    expect(mine).toContainEqual({ assignedUserId: "rep-1" });
    expect(mine[mine.length - 1]).toEqual(taskVisibilityFilter(rep));
  });
});
