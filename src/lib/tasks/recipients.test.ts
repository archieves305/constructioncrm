import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findMany: (...args: unknown[]) => findMany(...args) },
    task: { findUnique: vi.fn() },
  },
}));

const { resolveRecipients } = await import("./recipients");

type Row = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  taskEmailsEnabled: boolean;
  role: { name: string };
};

const user = (over: Partial<Row> & { id: string }): Row => ({
  email: `${over.id}@knuco.com`,
  firstName: "Test",
  lastName: "User",
  isActive: true,
  taskEmailsEnabled: true,
  role: { name: "OFFICE_STAFF" },
  ...over,
});

beforeEach(() => findMany.mockReset());

describe("resolveRecipients", () => {
  it("returns an active, unmuted candidate", async () => {
    findMany.mockResolvedValue([user({ id: "u1" })]);
    const { recipients } = await resolveRecipients({
      candidates: [{ userId: "u1", reason: "assignee" }],
    });
    expect(recipients.map((r) => r.userId)).toEqual(["u1"]);
  });

  it("suppresses the actor so nobody is emailed about their own click", async () => {
    findMany.mockResolvedValue([]);
    const { recipients, skipped } = await resolveRecipients({
      candidates: [{ userId: "u1", reason: "assignee" }],
      suppressUserId: "u1",
    });
    expect(recipients).toEqual([]);
    expect(skipped).toContainEqual({ userId: "u1", reason: "is-actor" });
    // Nothing left to look up, so we should not have hit the database at all.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("suppresses a user who muted task email", async () => {
    findMany.mockResolvedValue([user({ id: "u1", taskEmailsEnabled: false })]);
    const { recipients, skipped } = await resolveRecipients({
      candidates: [{ userId: "u1", reason: "assignee" }],
    });
    expect(recipients).toEqual([]);
    expect(skipped).toContainEqual({ userId: "u1", reason: "muted" });
  });

  it("suppresses a deactivated user", async () => {
    findMany.mockResolvedValue([user({ id: "u1", isActive: false })]);
    const { recipients, skipped } = await resolveRecipients({
      candidates: [{ userId: "u1", reason: "assignee" }],
    });
    expect(recipients).toEqual([]);
    expect(skipped).toContainEqual({ userId: "u1", reason: "inactive" });
  });

  it("suppresses a user with a blank email rather than sending to nowhere", async () => {
    findMany.mockResolvedValue([user({ id: "u1", email: "   " })]);
    const { recipients, skipped } = await resolveRecipients({
      candidates: [{ userId: "u1", reason: "assignee" }],
    });
    expect(recipients).toEqual([]);
    expect(skipped).toContainEqual({ userId: "u1", reason: "no-email" });
  });

  it("emails someone once when they are both assignee and watcher", async () => {
    findMany.mockResolvedValue([user({ id: "u1" })]);
    const { recipients } = await resolveRecipients({
      candidates: [
        { userId: "u1", reason: "watcher" },
        { userId: "u1", reason: "assignee" },
      ],
    });
    expect(recipients).toHaveLength(1);
    // The stronger relationship wins, whichever order they arrived in.
    expect(recipients[0].reason).toBe("assignee");
  });

  it("ignores null candidate ids from unassigned tasks", async () => {
    findMany.mockResolvedValue([user({ id: "u1" })]);
    const { recipients } = await resolveRecipients({
      candidates: [
        { userId: null, reason: "assignee" },
        { userId: "u1", reason: "assignor" },
      ],
    });
    expect(recipients.map((r) => r.userId)).toEqual(["u1"]);
  });

  it("carries the role through, since the CTA link depends on it", async () => {
    findMany.mockResolvedValue([user({ id: "u1", role: { name: "CREW_LEAD" } })]);
    const { recipients } = await resolveRecipients({
      candidates: [{ userId: "u1", reason: "assignee" }],
    });
    expect(recipients[0].role).toBe("CREW_LEAD");
  });

  it("does no work and no query when there are no candidates", async () => {
    const { recipients } = await resolveRecipients({ candidates: [] });
    expect(recipients).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
