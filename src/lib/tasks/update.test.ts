import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notify, recordTaskEvents, recordTaskEvent } = vi.hoisted(() => ({
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
  recordTaskEvent: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("./notify", () => notify);
vi.mock("./events", async (orig) => ({
  ...(await orig<typeof import("./events")>()),
  recordTaskEvents: (...a: unknown[]) => recordTaskEvents(...a),
  recordTaskEvent: (...a: unknown[]) => recordTaskEvent(...a),
}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("./transitions", () => ({ onTaskTransition: vi.fn() }));

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
  remindAt: null as Date | null,
  fieldIssue: null as null | { id: string; status: string },
};

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  for (const fn of Object.values(notify)) fn.mockReset().mockResolvedValue(undefined);
  recordTaskEvents.mockReset().mockResolvedValue(undefined);
  recordTaskEvent.mockReset().mockResolvedValue(undefined);
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

  it("a new due date resets the escalation ledger", async () => {
    await updateTask({ id: "t1", input: { dueAt: "2026-10-01" }, actorUserId: "u-jo" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.escalationLevel).toBe(0);
    expect(data.lastEscalatedAt).toBeNull();
  });

  it("the same due date leaves the escalation ledger alone", async () => {
    db.task.findUnique.mockResolvedValue({ ...existing, dueAt: new Date("2026-10-01T12:00:00.000Z") });
    await updateTask({ id: "t1", input: { dueAt: "2026-10-01" }, actorUserId: "u-jo" });
    expect(db.task.update.mock.calls[0][0].data.escalationLevel).toBeUndefined();
  });

  it("setting a reminder re-arms delivery, records who asked, and logs it", async () => {
    await updateTask({ id: "t1", input: { remindAt: "2026-10-03" }, actorUserId: "u-jo" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.remindAt.toISOString()).toBe("2026-10-03T12:00:00.000Z");
    expect(data.remindedAt).toBeNull();
    expect(data.remindSetBy).toEqual({ connect: { id: "u-jo" } });
    expect(recordTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "REMINDER_SET", toValue: "2026-10-03T12:00:00.000Z" }),
    );
  });

  it("clearing a reminder disarms it", async () => {
    db.task.findUnique.mockResolvedValue({ ...existing, remindAt: new Date("2026-10-03T12:00:00.000Z") });
    await updateTask({ id: "t1", input: { remindAt: null }, actorUserId: "u-jo" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.remindAt).toBeNull();
    expect(data.remindSetBy).toEqual({ disconnect: true });
    expect(recordTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "REMINDER_SET", toValue: null }));
  });
});

describe("updateTask — workflow steps", () => {
  const step = {
    ...existing,
    jobId: "j1",
    workflowInstanceId: "w1",
    workflowTaskKey: "roofing:mobilize",
    workflowAnchor: "PREDECESSOR" as const,
    dueOffsetBusinessDays: 2,
    blocking: false,
    activatedAt: new Date("2026-10-01T12:00:00Z"),
    dueLocked: false,
    skipReason: null as string | null,
    requiredEvidence: null as "ATTACHMENT" | null,
    requiredEvidenceParam: null,
    checklist: null as unknown,
    inspectionResult: null,
  };
  const eventTypes = () => recordTaskEvent.mock.calls.map((c) => (c[0] as { type: string }).type);

  it("refuses to skip a step without a reason", async () => {
    db.task.findUnique.mockResolvedValue(step);
    await expect(updateTask({ id: "t1", input: { status: "CANCELLED" }, actorUserId: "u-jo", actorRole: "OFFICE_STAFF" })).rejects.toMatchObject({
      status: 400,
      message: "Say why this step is being skipped",
    });
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("records the skip reason and a SKIPPED row", async () => {
    db.task.findUnique.mockResolvedValue(step);
    await updateTask({ id: "t1", input: { status: "CANCELLED", skipReason: "Owner supplied the dumpster" }, actorUserId: "u-jo", actorRole: "OFFICE_STAFF", notify: "none" });
    expect(db.task.update.mock.calls[0][0].data.skipReason).toBe("Owner supplied the dumpster");
    expect(eventTypes()).toContain("SKIPPED");
  });

  it("only an admin or manager may skip a blocking gate", async () => {
    db.task.findUnique.mockResolvedValue({ ...step, blocking: true });
    await expect(
      updateTask({ id: "t1", input: { status: "CANCELLED", skipReason: "n/a" }, actorUserId: "u-jo", actorRole: "OFFICE_STAFF" }),
    ).rejects.toMatchObject({ status: 403 });
    await updateTask({ id: "t1", input: { status: "CANCELLED", skipReason: "n/a" }, actorUserId: "u-jo", actorRole: "MANAGER", notify: "none" });
    expect(db.task.update).toHaveBeenCalledTimes(1);
  });

  it("will not complete a step with an open checklist item, and merges ticks first", async () => {
    const checklist = [{ key: "a", label: "A", done: false }, { key: "b", label: "B", done: false }];
    db.task.findUnique.mockResolvedValue({ ...step, checklist });
    await expect(updateTask({ id: "t1", input: { status: "COMPLETED", checklist: [{ key: "a", done: true }] }, actorUserId: "u-jo", actorRole: "ADMIN" })).rejects.toMatchObject({
      status: 400,
      hint: "checklist",
    });
    // Ticking the last box in the same save is enough.
    await updateTask({ id: "t1", input: { status: "COMPLETED", checklist: [{ key: "a", done: true }, { key: "b", done: true }] }, actorUserId: "u-jo", actorRole: "ADMIN", notify: "none" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.status).toBe("COMPLETED");
    expect((data.checklist as { done: boolean }[]).every((c) => c.done)).toBe(true);
    expect(eventTypes()).toContain("CHECKLIST_UPDATED");
  });

  it("an admin may override missing evidence with a reason; others get the plain-English 400", async () => {
    db.task.findUnique.mockResolvedValue({ ...step, requiredEvidence: "ATTACHMENT" });
    (db as unknown as { file: { count: ReturnType<typeof vi.fn> } }).file = { count: vi.fn().mockResolvedValue(0) };
    await expect(updateTask({ id: "t1", input: { status: "COMPLETED" }, actorUserId: "u-jo", actorRole: "OFFICE_STAFF" })).rejects.toMatchObject({
      status: 400,
      message: "Attach the document to this step before completing it",
    });
    await updateTask({ id: "t1", input: { status: "COMPLETED", evidenceOverrideReason: "Paper copy in the job folder" }, actorUserId: "u-jo", actorRole: "ADMIN", notify: "none" });
    expect(db.task.update).toHaveBeenCalledTimes(1);
    expect(recordTaskEvent.mock.calls.some((c) => (c[0] as { type: string; body?: string }).type === "NOTE" && (c[0] as { body?: string }).body?.includes("overridden"))).toBe(true);
  });

  it("a hand-edited due date locks the step; unlocking hands it back to the engine", async () => {
    db.task.findUnique.mockResolvedValue(step);
    await updateTask({ id: "t1", input: { dueAt: "2026-11-02" }, actorUserId: "u-jo", notify: "none" });
    expect(db.task.update.mock.calls[0][0].data.dueLocked).toBe(true);

    db.task.update.mockClear();
    db.task.findUnique.mockResolvedValue({ ...step, dueLocked: true, dueAt: new Date("2026-11-02T12:00:00Z") });
    (db as unknown as { jobWorkflowInstance: { findUnique: ReturnType<typeof vi.fn> } }).jobWorkflowInstance = {
      findUnique: vi.fn().mockResolvedValue({ appliedAt: step.activatedAt, job: { createdAt: step.activatedAt, targetStartDate: null } }),
    };
    await updateTask({ id: "t1", input: { dueLocked: false }, actorUserId: "u-jo", notify: "none" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.dueLocked).toBe(false);
    expect(data.dueAt).toBeInstanceOf(Date); // recomputed from activation + 2 business days
  });

  it("starting a Not-active step activates it out of order", async () => {
    db.task.findUnique.mockResolvedValue({ ...step, activatedAt: null, dueAt: null });
    (db as unknown as { jobWorkflowInstance: { findUnique: ReturnType<typeof vi.fn> } }).jobWorkflowInstance = {
      findUnique: vi.fn().mockResolvedValue({ appliedAt: new Date(), job: { createdAt: new Date(), targetStartDate: null } }),
    };
    await updateTask({ id: "t1", input: { status: "IN_PROGRESS" }, actorUserId: "u-jo", notify: "none" });
    const data = db.task.update.mock.calls[0][0].data;
    expect(data.activatedAt).toBeInstanceOf(Date);
    expect(data.dueAt).toBeInstanceOf(Date);
    expect(recordTaskEvent.mock.calls.some((c) => (c[0] as { type: string; toValue?: string }).type === "ACTIVATED" && (c[0] as { toValue?: string }).toValue === "out_of_order")).toBe(true);
  });

  it("ordinary tasks are untouched by the workflow rules", async () => {
    db.task.findUnique.mockResolvedValue({ ...existing, workflowTaskKey: null, workflowInstanceId: null });
    await updateTask({ id: "t1", input: { status: "CANCELLED" }, actorUserId: "u-jo", actorRole: "SALES_REP", notify: "none" });
    expect(db.task.update).toHaveBeenCalledTimes(1);
    expect(db.task.update.mock.calls[0][0].data.dueLocked).toBeUndefined();
  });
});
