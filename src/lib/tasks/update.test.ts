import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notify, recordTaskEvents } = vi.hoisted(() => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    activityLog: { create: vi.fn() },
    fieldIssue: { update: vi.fn() },
  },
  notify: {
    notifyTaskAssigned: vi.fn(),
    notifyTaskBlocked: vi.fn(),
    notifyTaskCompleted: vi.fn(),
  },
  recordTaskEvents: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("./notify", () => notify);
vi.mock("./events", async (orig) => ({
  ...(await orig<typeof import("./events")>()),
  recordTaskEvents: (...a: unknown[]) => recordTaskEvents(...a),
}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { updateTask, TaskUpdateError } = await import("./update");

const existing = {
  id: "t1",
  status: "PENDING" as const,
  priority: "URGENT" as const,
  dueAt: null,
  assignedUserId: "u-frank",
  createdByUserId: "u-jo",
  blockedReason: null,
  leadId: "l1",
  title: "Order shingles",
  fieldIssue: null as null | { id: string; status: string },
};

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  for (const fn of Object.values(notify)) fn.mockReset().mockResolvedValue(undefined);
  recordTaskEvents.mockReset().mockResolvedValue(undefined);
  db.task.findUnique.mockResolvedValue(existing);
  db.task.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...existing,
    ...data,
    status: (data.status as string) ?? existing.status,
    assignedUserId:
      data.assignedTo === undefined
        ? existing.assignedUserId
        : ((data.assignedTo as { connect?: { id: string } }).connect?.id ?? null),
  }));
  db.activityLog.create.mockResolvedValue({});
  db.fieldIssue.update.mockResolvedValue({});
});

describe("updateTask", () => {
  it("404s on a missing task", async () => {
    db.task.findUnique.mockResolvedValue(null);
    await expect(updateTask({ id: "x", input: {}, actorUserId: "u-jo" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("403s when the authorizer says no, before writing anything", async () => {
    await expect(
      updateTask({ id: "t1", input: { title: "x" }, actorUserId: "u-x", authorize: () => false }),
    ).rejects.toBeInstanceOf(TaskUpdateError);
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("completing sets completedAt/By, logs lead activity and mails the audience", async () => {
    const { task, statusChanged } = await updateTask({
      id: "t1",
      input: { status: "COMPLETED" },
      actorUserId: "u-jo",
    });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(data.completedBy).toEqual({ connect: { id: "u-jo" } });
    expect(statusChanged).toBe(true);
    expect(task.status).toBe("COMPLETED");
    expect(db.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activityType: "TASK_COMPLETED" }) }),
    );
    expect(notify.notifyTaskCompleted).toHaveBeenCalledWith({ taskId: "t1", actorUserId: "u-jo" });
  });

  it("reopening clears both completion fields", async () => {
    db.task.findUnique.mockResolvedValue({ ...existing, status: "COMPLETED" });
    await updateTask({ id: "t1", input: { status: "PENDING" }, actorUserId: "u-jo" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.completedAt).toBeNull();
    expect(data.completedBy).toEqual({ disconnect: true });
  });

  it("does not touch priority when the input omits it", async () => {
    await updateTask({ id: "t1", input: { status: "COMPLETED" }, actorUserId: "u-jo" });
    expect(db.task.update.mock.calls[0][0].data.priority).toBeUndefined();
  });

  it("refuses BLOCKED without a reason and writes nothing", async () => {
    await expect(
      updateTask({ id: "t1", input: { status: "BLOCKED" }, actorUserId: "u-jo" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("blocking with a reason mails the audience", async () => {
    await updateTask({
      id: "t1",
      input: { status: "BLOCKED", blockedReason: "Waiting on permit" },
      actorUserId: "u-jo",
    });
    expect(db.task.update.mock.calls[0][0].data.blockedReason).toBe("Waiting on permit");
    expect(notify.notifyTaskBlocked).toHaveBeenCalled();
  });

  it("reassigning resets assignedAt and tells the new owner as a reassignment", async () => {
    const { assigneeChanged } = await updateTask({
      id: "t1",
      input: { assignedUserId: "u-ana" },
      actorUserId: "u-jo",
    });
    expect(assigneeChanged).toBe(true);
    expect(db.task.update.mock.calls[0][0].data.assignedAt).toBeInstanceOf(Date);
    expect(notify.notifyTaskAssigned).toHaveBeenCalledWith({
      taskId: "t1",
      actorUserId: "u-jo",
      reassigned: true,
    });
  });

  it("unassigning nulls assignedAt and mails nobody", async () => {
    await updateTask({ id: "t1", input: { assignedUserId: null }, actorUserId: "u-jo" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.assignedTo).toEqual({ disconnect: true });
    expect(data.assignedAt).toBeNull();
    expect(notify.notifyTaskAssigned).not.toHaveBeenCalled();
  });

  it("completing resolves a still-open linked field issue, once", async () => {
    db.task.findUnique.mockResolvedValue({
      ...existing,
      fieldIssue: { id: "fi1", status: "PENDING" },
    });
    await updateTask({ id: "t1", input: { status: "COMPLETED" }, actorUserId: "u-jo" });
    expect(db.fieldIssue.update).toHaveBeenCalledWith({
      where: { id: "fi1" },
      data: expect.objectContaining({ status: "COMPLETED", resolvedByUserId: "u-jo" }),
    });
  });

  it("leaves an already-resolved field issue alone (no ping-pong)", async () => {
    db.task.findUnique.mockResolvedValue({
      ...existing,
      fieldIssue: { id: "fi1", status: "COMPLETED" },
    });
    await updateTask({ id: "t1", input: { status: "COMPLETED" }, actorUserId: "u-jo" });
    expect(db.fieldIssue.update).not.toHaveBeenCalled();
  });

  it("notify: none sends nothing", async () => {
    await updateTask({ id: "t1", input: { status: "COMPLETED" }, actorUserId: "u-jo", notify: "none" });
    expect(notify.notifyTaskCompleted).not.toHaveBeenCalled();
  });
});
