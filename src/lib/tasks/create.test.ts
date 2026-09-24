import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notifyTaskAssigned } = vi.hoisted(() => ({
  db: {
    task: { create: vi.fn() },
    taskEvent: { createMany: vi.fn() },
    taskWatcher: { createMany: vi.fn() },
    activityLog: { create: vi.fn() },
    invoice: { findUnique: vi.fn() },
    dailyLog: { findUnique: vi.fn() },
    estimate: { findUnique: vi.fn() },
    prospect: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
  },
  notifyTaskAssigned: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("./notify", () => ({ notifyTaskAssigned: (...a: unknown[]) => notifyTaskAssigned(...a) }));
// No request scope in a test: run deferred work immediately.
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { createTask, TaskLinkError } = await import("./create");

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  notifyTaskAssigned.mockReset().mockResolvedValue(undefined);
  db.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "t1",
    ...data,
  }));
  db.taskEvent.createMany.mockResolvedValue({ count: 1 });
  db.taskWatcher.createMany.mockResolvedValue({ count: 1 });
  db.activityLog.create.mockResolvedValue({});
});

const base = { title: "Call the customer", createdByUserId: "u-creator" };

describe("createTask", () => {
  it("writes CREATED and ASSIGNED rows and tells the assignee", async () => {
    await createTask({ ...base, assignedUserId: "u-frank", source: "manual" });

    const events = db.taskEvent.createMany.mock.calls[0][0].data;
    expect(events).toEqual([
      expect.objectContaining({ type: "CREATED", toValue: "manual", actorUserId: "u-creator" }),
      expect.objectContaining({ type: "ASSIGNED", toValue: "u-frank" }),
    ]);
    expect(db.task.create.mock.calls[0][0].data.assignedAt).toBeInstanceOf(Date);
    expect(notifyTaskAssigned).toHaveBeenCalledWith({ taskId: "t1", actorUserId: "u-creator" });
  });

  it("records only CREATED and sends nothing when unassigned", async () => {
    await createTask(base);
    const events = db.taskEvent.createMany.mock.calls[0][0].data;
    expect(events.map((e: { type: string }) => e.type)).toEqual(["CREATED"]);
    expect(db.task.create.mock.calls[0][0].data.assignedAt).toBeNull();
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
  });

  it("lets the actor be the system so a self-created lead still notifies", async () => {
    await createTask({ ...base, assignedUserId: "u-creator" }, { actorUserId: null });
    expect(notifyTaskAssigned).toHaveBeenCalledWith({ taskId: "t1", actorUserId: null });
    expect(db.taskEvent.createMany.mock.calls[0][0].data[0].actorUserId).toBeNull();
  });

  it("skips mail entirely for notify: none", async () => {
    await createTask({ ...base, assignedUserId: "u-frank" }, { notify: "none" });
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
  });

  it("adds explicit watchers, minus the assignee and creator, with WATCHER_ADDED rows", async () => {
    await createTask({
      ...base,
      assignedUserId: "u-frank",
      watcherUserIds: ["u-pm", "u-frank", "u-creator", "u-pm"],
    });
    expect(db.taskWatcher.createMany).toHaveBeenCalledWith({
      data: [{ taskId: "t1", userId: "u-pm" }],
      skipDuplicates: true,
    });
    const types = db.taskEvent.createMany.mock.calls[0][0].data.map((e: { type: string }) => e.type);
    expect(types).toEqual(["CREATED", "ASSIGNED", "WATCHER_ADDED"]);
  });

  it("derives the job from an invoice and the lead from the job", async () => {
    db.invoice.findUnique.mockResolvedValue({ jobId: "j1" });
    db.job.findUnique.mockResolvedValue({ leadId: "l1" });
    await createTask({ ...base, invoiceId: "inv1" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({
      invoiceId: "inv1",
      jobId: "j1",
      leadId: "l1",
    });
  });

  it("derives the lead from an estimate", async () => {
    db.estimate.findUnique.mockResolvedValue({ leadId: "l9" });
    await createTask({ ...base, estimateId: "e1" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ estimateId: "e1", leadId: "l9" });
  });

  it("refuses an unknown link with a 400-mappable error", async () => {
    db.dailyLog.findUnique.mockResolvedValue(null);
    await expect(createTask({ ...base, dailyLogId: "nope" })).rejects.toBeInstanceOf(TaskLinkError);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("logs lead activity by default and not when asked to stay quiet", async () => {
    await createTask({ ...base, leadId: "l1" });
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
    db.activityLog.create.mockClear();
    await createTask({ ...base, leadId: "l1" }, { logLeadActivity: false });
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });

  it("writes through the transaction client it is given", async () => {
    const tx = {
      ...db,
      task: { create: vi.fn().mockResolvedValue({ id: "t-tx", assignedUserId: null }) },
      taskEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await createTask(base, { db: tx as never });
    expect(tx.task.create).toHaveBeenCalled();
    expect(tx.taskEvent.createMany).toHaveBeenCalled();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("stores the automation key and a reminder, attributing the reminder to the creator", async () => {
    const remindAt = new Date("2026-10-03T12:00:00.000Z");
    await createTask({ ...base, sourceKey: "invoice:SENT:inv1", remindAt });
    const data = db.task.create.mock.calls[0][0].data;
    expect(data.sourceKey).toBe("invoice:SENT:inv1");
    expect(data.remindAt).toBe(remindAt);
    expect(data.remindSetByUserId).toBe("u-creator");
    const types = db.taskEvent.createMany.mock.calls[0][0].data.map((e: { type: string }) => e.type);
    expect(types).toEqual(["CREATED", "REMINDER_SET"]);
  });
});
