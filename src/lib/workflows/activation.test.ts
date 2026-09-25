import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notifyTasksReady } = vi.hoisted(() => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    taskDependency: { findMany: vi.fn() },
    taskEvent: { createMany: vi.fn() },
    jobWorkflowInstance: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  notifyTasksReady: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("./notify", () => ({ notifyTasksReady: (...a: unknown[]) => notifyTasksReady(...a) }));

const { onTaskClosed, sweepActivation } = await import("./activation");

const fri = new Date(2026, 9, 2, 10, 0, 0); // Fri
// What `loadSubjectForInstance` reads: the instance with its owning job.
const ctxRow = {
  id: "w1",
  appliedAt: fri,
  permitStatus: "UNDETERMINED",
  scopeToggles: {},
  modules: [],
  jobId: "j1",
  violationCaseId: null,
  job: { id: "j1", leadId: "l1", jobNumber: "JOB-00001", createdAt: fri, targetStartDate: null, jurisdiction: null, projectManagerId: null, salesRepId: null },
  violationCase: null,
};

const waiting = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "PENDING",
  dueAt: null,
  dueLocked: false,
  activatedAt: null,
  workflowAnchor: "PREDECESSOR",
  dueOffsetBusinessDays: 2,
  assignedUserId: "u-frank",
  ...extra,
});

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  notifyTasksReady.mockReset();
  db.task.update.mockResolvedValue({});
  db.taskEvent.createMany.mockResolvedValue({ count: 1 });
  db.task.count.mockResolvedValue(3);
  db.jobWorkflowInstance.updateMany.mockResolvedValue({ count: 0 });
  db.jobWorkflowInstance.findUnique.mockResolvedValue(ctxRow);
});

describe("onTaskClosed", () => {
  it("activates a dependent whose blocking predecessors are all satisfied, with a due date from now", async () => {
    db.task.findUnique.mockResolvedValue({
      id: "a",
      status: "COMPLETED",
      workflowInstanceId: "w1",
      dependents: [{ kind: "BLOCKING", task: waiting("b") }],
    });
    db.taskDependency.findMany.mockResolvedValue([{ kind: "BLOCKING", dependsOn: { status: "COMPLETED" } }]);

    const r = await onTaskClosed({ taskId: "a", actorUserId: "u-me", now: fri });
    expect(r.activated).toEqual(["b"]);
    const upd = db.task.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "b" });
    expect(upd.data.activatedAt).toEqual(fri);
    expect(upd.data.dueAt.getDate()).toBe(6); // Fri + 2 business days = Tue
    expect(upd.data.dueAt.getHours()).toBe(17);
    const events = db.taskEvent.createMany.mock.calls[0][0].data.map((e: { type: string; toValue: string | null }) => [e.type, e.toValue]);
    expect(events).toEqual([["ACTIVATED", "dependencies"], ["DUE_CHANGED", upd.data.dueAt.toISOString()]]);
    expect(notifyTasksReady).toHaveBeenCalledWith(["b"], "u-me");
  });

  it("leaves a dependent waiting when another blocking predecessor is still open", async () => {
    db.task.findUnique.mockResolvedValue({
      id: "a",
      status: "COMPLETED",
      workflowInstanceId: "w1",
      dependents: [{ kind: "BLOCKING", task: waiting("b") }],
    });
    db.taskDependency.findMany.mockResolvedValue([
      { kind: "BLOCKING", dependsOn: { status: "COMPLETED" } },
      { kind: "BLOCKING", dependsOn: { status: "IN_PROGRESS" } },
    ]);
    const r = await onTaskClosed({ taskId: "a", actorUserId: "u-me", now: fri });
    expect(r.activated).toEqual([]);
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("a skipped (CANCELLED) predecessor satisfies the dependency", async () => {
    db.task.findUnique.mockResolvedValue({
      id: "a",
      status: "CANCELLED",
      workflowInstanceId: "w1",
      dependents: [{ kind: "BLOCKING", task: waiting("b") }],
    });
    db.taskDependency.findMany.mockResolvedValue([{ kind: "BLOCKING", dependsOn: { status: "CANCELLED" } }]);
    expect((await onTaskClosed({ taskId: "a", actorUserId: null, now: fri })).activated).toEqual(["b"]);
  });

  it("keeps a hand-locked due date and only refreshes DATE_ONLY dependents that are already active", async () => {
    db.task.findUnique.mockResolvedValue({
      id: "a",
      status: "COMPLETED",
      workflowInstanceId: "w1",
      dependents: [
        { kind: "BLOCKING", task: waiting("locked", { dueLocked: true, dueAt: new Date(2026, 11, 1) }) },
        { kind: "DATE_ONLY", task: waiting("active", { activatedAt: fri, dueAt: new Date(2026, 8, 1) }) },
      ],
    });
    db.taskDependency.findMany.mockResolvedValue([{ kind: "BLOCKING", dependsOn: { status: "COMPLETED" } }]);
    const r = await onTaskClosed({ taskId: "a", actorUserId: "u-me", now: fri });
    expect(r.activated).toEqual(["locked"]);
    const byId = Object.fromEntries(db.task.update.mock.calls.map((c) => [c[0].where.id, c[0].data]));
    expect(byId.locked.dueAt).toEqual(new Date(2026, 11, 1));
    expect(byId.active.dueAt.getDate()).toBe(6);
    expect(byId.active.activatedAt).toBeUndefined();
  });

  it("does nothing for a manual task or a reopen, and marks the instance complete when nothing is open", async () => {
    db.task.findUnique.mockResolvedValue({ id: "m", status: "COMPLETED", workflowInstanceId: null, dependents: [] });
    expect((await onTaskClosed({ taskId: "m", actorUserId: null })).activated).toEqual([]);

    db.task.findUnique.mockResolvedValue({ id: "a", status: "PENDING", workflowInstanceId: "w1", dependents: [] });
    expect((await onTaskClosed({ taskId: "a", actorUserId: null })).activated).toEqual([]);

    db.task.findUnique.mockResolvedValue({ id: "last", status: "COMPLETED", workflowInstanceId: "w1", dependents: [] });
    db.task.count.mockResolvedValue(0);
    await onTaskClosed({ taskId: "last", actorUserId: null });
    expect(db.jobWorkflowInstance.updateMany).toHaveBeenCalledWith({
      where: { id: "w1", status: "ACTIVE" },
      data: { status: "COMPLETED" },
    });
  });
});

describe("sweepActivation", () => {
  it("wakes every waiting step whose predecessors are already satisfied", async () => {
    db.task.findMany.mockResolvedValue([
      { ...waiting("ready"), dependencies: [{ kind: "BLOCKING", dependsOn: { status: "COMPLETED" } }] },
      { ...waiting("held"), dependencies: [{ kind: "BLOCKING", dependsOn: { status: "PENDING" } }] },
      { ...waiting("free"), dependencies: [] },
    ]);
    const out = await sweepActivation("w1", "u-me", fri);
    expect(out.sort()).toEqual(["free", "ready"]);
  });
});

describe("onTaskClosed — failed inspection", () => {
  it("reopens a failed inspection as Ready once its correction task closes", async () => {
    db.task.findUnique.mockResolvedValue({
      id: "corr",
      status: "COMPLETED",
      workflowInstanceId: "w1",
      dependents: [{ kind: "BLOCKING", task: waiting("insp", { status: "BLOCKED", activatedAt: fri, inspectionResult: "FAIL", dueAt: new Date(2026, 8, 1) }) }],
    });
    db.taskDependency.findMany.mockResolvedValue([{ kind: "BLOCKING", dependsOn: { status: "COMPLETED" } }]);
    const r = await onTaskClosed({ taskId: "corr", actorUserId: "u-me", now: fri });
    expect(r.activated).toEqual(["insp"]);
    // Only correction tasks gate the re-request, never the inspection's ordinary predecessors.
    expect(db.taskDependency.findMany.mock.calls[0][0].where.dependsOn.workflowTaskKey).toEqual({ contains: ":correction:" });
    const upd = db.task.update.mock.calls[0][0];
    expect(upd.data).toMatchObject({ status: "PENDING", blockedReason: null, inspectionResult: null });
    expect(upd.data.dueAt.getDate()).toBe(6);
    const types = db.taskEvent.createMany.mock.calls[0][0].data.map((e: { type: string }) => e.type);
    expect(types).toEqual(["UNBLOCKED", "DUE_CHANGED"]);
  });
});
