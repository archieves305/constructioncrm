import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/brand", () => ({ getEmailBrand: vi.fn() }));
vi.mock("@/lib/email/delivery-report", () => ({ reportDelivery: vi.fn() }));

const { planDigest } = await import("./reminders");

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
