import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/brand", () => ({ getEmailBrand: vi.fn() }));
vi.mock("@/lib/email/delivery-report", () => ({ reportDelivery: vi.fn() }));

const { planDigest, describeWhen } = await import("./reminders");

const todayStart = new Date(2026, 8, 24);
const base = { title: "x", priority: "MEDIUM" as const, job: null, lead: null };

describe("planDigest", () => {
  it("splits an assignee's tasks into overdue and due today", () => {
    const plan = planDigest(
      [
        { ...base, id: "a", dueAt: new Date(2026, 8, 22), assignedUserId: "u1" },
        { ...base, id: "b", dueAt: new Date(2026, 8, 24, 16), assignedUserId: "u1" },
      ],
      [],
      todayStart,
    );
    expect(plan.get("u1")?.overdue.map((t) => t.id)).toEqual(["a"]);
    expect(plan.get("u1")?.dueToday.map((t) => t.id)).toEqual(["b"]);
  });

  it("a reminder set by someone else reaches both, with the right roles", () => {
    const plan = planDigest(
      [],
      [
        {
          ...base,
          id: "r",
          dueAt: null,
          assignedUserId: "frank",
          createdByUserId: "jo",
          remindSetByUserId: "jo",
          remindSetBy: { firstName: "Jo", lastName: "G" },
        },
      ],
      todayStart,
    );
    expect(plan.get("frank")?.reminders).toEqual([expect.objectContaining({ role: "primary" })]);
    expect(plan.get("jo")?.reminders).toEqual([expect.objectContaining({ role: "setter" })]);
  });

  it("a reminder you set for yourself reaches you once", () => {
    const plan = planDigest(
      [],
      [
        {
          ...base,
          id: "r",
          dueAt: null,
          assignedUserId: "frank",
          createdByUserId: "frank",
          remindSetByUserId: "frank",
          remindSetBy: null,
        },
      ],
      todayStart,
    );
    expect(plan.size).toBe(1);
    expect(plan.get("frank")?.reminders).toHaveLength(1);
  });

  it("an unassigned reminder falls back to the creator", () => {
    const plan = planDigest(
      [],
      [
        {
          ...base,
          id: "r",
          dueAt: null,
          assignedUserId: null,
          createdByUserId: "jo",
          remindSetByUserId: "jo",
          remindSetBy: null,
        },
      ],
      todayStart,
    );
    expect([...plan.keys()]).toEqual(["jo"]);
  });
});

describe("planDigest — schedule changes and job starts", () => {
  const task = { ...base, id: "t1", dueAt: new Date(2026, 8, 30, 12), assignedUserId: "u1", scheduledStart: null, allDay: true };
  const change = (createdAt: Date, toValue: string) => ({ taskId: "t1", type: "DUE_CHANGED" as const, fromValue: null, toValue, createdAt, actor: null, task });
  it("keeps only the latest move per task and hands it to the assignee", () => {
    const plan = planDigest([], [], todayStart, [change(new Date(2026, 8, 27, 9), "a"), change(new Date(2026, 8, 27, 15), "b")]);
    expect(plan.get("u1")?.changed.map((c) => c.toValue)).toEqual(["b"]);
  });
  it("a job start reaches each involved person once", () => {
    const plan = planDigest([], [], todayStart, [], [{ id: "j1", title: "Roof — 12 Palm Ct", job: { id: "j1", jobNumber: "JOB-1", title: "Roof", lead: null }, userIds: ["u1", "u2", "u1"] }]);
    expect(plan.get("u1")?.starting).toHaveLength(1);
    expect(plan.get("u2")?.starting).toHaveLength(1);
  });
});

describe("describeWhen", () => {
  it("names the day, and the window for a timed task", () => {
    expect(describeWhen({ dueAt: new Date("2026-09-29T12:00:00.000Z"), scheduledStart: null, allDay: true })).toBe("Tue, Sep 29");
    expect(describeWhen({ dueAt: new Date("2026-09-29T15:00:00.000Z"), scheduledStart: new Date("2026-09-29T13:00:00.000Z"), allDay: false })).toMatch(/^Tue, Sep 29 · /);
    expect(describeWhen({ dueAt: null, scheduledStart: null, allDay: true })).toBe("No date");
  });
});
