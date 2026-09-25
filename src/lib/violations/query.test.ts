import { describe, expect, it } from "vitest";
import type { RoleName } from "@/generated/prisma/client";
import { buildViolationListWhere, parseViolationListParams, parseScheduleParams, buildHearingWhere } from "./query";

const now = new Date("2026-09-25T14:00:00Z");
const office = { id: "u-office", role: "OFFICE_STAFF" as const };
const rep = { id: "u-rep", role: "SALES_REP" as const };
const w = (qs: string, user: { id: string; role: RoleName } = office) => buildViolationListWhere(parseViolationListParams(new URLSearchParams(qs)), { user, now });
const clauses = (qs: string, user: { id: string; role: RoleName } = office) => w(qs, user).AND as Record<string, unknown>[];

describe("parseViolationListParams", () => {
  it("defaults to the open list, page 1, 25 rows, and ignores unknown views and statuses", () => {
    expect(parseViolationListParams(new URLSearchParams(""))).toMatchObject({ view: "all", page: 1, pageSize: 25, withinDays: 7, flags: {} });
    expect(parseViolationListParams(new URLSearchParams("view=bogus&status=NOPE&withinDays=900&pageSize=9999")).view).toBe("all");
    expect(parseViolationListParams(new URLSearchParams("view=overdue&finesAccruing=1&blocked=true&withinDays=14"))).toMatchObject({ view: "overdue", flags: { finesAccruing: true, blocked: true }, withinDays: 14 });
  });
});

describe("buildViolationListWhere", () => {
  it("'all' shows open cases unless a status is given; 'closed' shows the terminal ones", () => {
    expect(clauses("")[0]).toEqual({ status: { in: ["NEW", "ACTIVE", "ON_HOLD", "APPEALED", "COMPLIED"] } });
    expect(clauses("status=CLOSED")[0]).toEqual({ status: "CLOSED" });
    expect(clauses("view=closed")[0]).toEqual({ status: { in: ["CLOSED", "CANCELLED"] } });
  });

  it("queues are honest predicates: overdue and due-soon exclude confirmed cases; awaiting-agency needs a reinspection request", () => {
    expect(clauses("view=overdue")[1]).toEqual({ agencyConfirmedAt: null, currentDeadline: { lt: now } });
    const due = clauses("view=due-soon&withinDays=3")[1] as { currentDeadline: { gte: Date; lte: Date } };
    expect(due.currentDeadline.gte).toEqual(now);
    expect(due.currentDeadline.lte).toEqual(new Date("2026-09-28T14:00:00Z"));
    expect(clauses("view=awaiting-agency")[1]).toEqual({ reinspectionRequestedAt: { not: null }, agencyConfirmedAt: null });
    expect(clauses("view=fines")[1]).toEqual({ OR: [{ dailyFine: { gt: 0 }, fineAccrualStartDate: { lte: now }, fineAccrualStoppedAt: null }, { lienStatus: "RECORDED" }, { officialBalance: { gt: 0 }, fineResolvedAt: null }] });
  });

  it("'mine' is manager, item assignee, active task assignee or team slot", () => {
    expect(clauses("view=mine", rep)[1]).toEqual({
      OR: [
        { caseManagerId: "u-rep" },
        { items: { some: { assignedUserId: "u-rep" } } },
        { tasks: { some: { assignedUserId: "u-rep", status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, activatedAt: { not: null } } } },
        { workflow: { team: { some: { userId: "u-rep" } } } },
      ],
    });
  });

  it("always ANDs the role scope last: empty for office roles, relationship-based for own-only roles", () => {
    expect(clauses("").at(-1)).toEqual({});
    expect(clauses("", rep).at(-1)).toMatchObject({ OR: expect.arrayContaining([{ caseManagerId: "u-rep" }]) });
  });

  it("filters: unassigned manager, category, phase, search across the case and its lead", () => {
    expect(clauses("caseManagerId=__unassigned")).toContainEqual({ caseManagerId: null });
    expect(clauses("categoryId=cat1")).toContainEqual({ items: { some: { categoryId: "cat1" } } });
    expect(clauses("phaseKey=code_violation:intake")).toContainEqual({ tasks: { some: { workflowTaskKey: { not: null }, workflowPhaseKey: "code_violation:intake", status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, activatedAt: { not: null } } } });
    const search = clauses("search=Main").find((c) => Array.isArray((c as { OR?: unknown[] }).OR) && ((c as { OR: unknown[] }).OR.length === 7)) as { OR: unknown[] };
    expect(search.OR).toContainEqual({ lead: { OR: [{ propertyAddress1: { contains: "Main", mode: "insensitive" } }, { fullName: { contains: "Main", mode: "insensitive" } }] } });
    expect(clauses("unlinked=1&leadId=l1")).toEqual(expect.arrayContaining([{ jobId: null }, { leadId: "l1" }]));
  });

  it("schedule params default to upcoming and scope hearings by the viewer", () => {
    const p = parseScheduleParams(new URLSearchParams("from=2026-10-01&status=pending"));
    expect(p.status).toBe("pending");
    expect(p.from?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    const hw = buildHearingWhere(p, { user: rep, now }).AND as Record<string, unknown>[];
    expect(hw[0]).toEqual({ status: { in: ["SCHEDULED", "CONTINUED", "HELD"] }, outcome: null });
    expect(hw.at(-1)).toMatchObject({ case: { AND: expect.any(Array) } });
  });
});
