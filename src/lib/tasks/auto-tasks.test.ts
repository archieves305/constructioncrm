import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, createTask, recordTaskEvent, envRef } = vi.hoisted(() => ({
  db: {
    task: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    invoice: { findUnique: vi.fn() },
    estimate: { findUnique: vi.fn() },
    dailyLog: { findUnique: vi.fn() },
    changeOrder: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    lead: { updateMany: vi.fn() },
  },
  createTask: vi.fn(),
  recordTaskEvent: vi.fn(),
  envRef: { TASK_AUTO_RULES_DISABLED: "" },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/env", () => ({ env: envRef }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("./create", () => ({ createTask: (...a: unknown[]) => createTask(...a) }));
vi.mock("./events", () => ({ recordTaskEvent: (...a: unknown[]) => recordTaskEvent(...a) }));

const { ensureAutoTask, closeAutoTask, onInvoiceTransition, sourceKeyFor, isRuleEnabled } = await import("./auto-tasks");

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  createTask.mockReset().mockResolvedValue({ id: "t-new" });
  recordTaskEvent.mockReset().mockResolvedValue(undefined);
  envRef.TASK_AUTO_RULES_DISABLED = "";
  db.task.updateMany.mockResolvedValue({ count: 1 });
});

describe("sourceKeyFor / isRuleEnabled", () => {
  it("shapes keys per kind", () => {
    expect(sourceKeyFor({ kind: "invoice.sent", invoiceId: "i1" })).toBe("invoice:SENT:i1");
    expect(sourceKeyFor({ kind: "daily-log.returned", dailyLogId: "d1", crewLeadUserId: null })).toBe(
      "daily-log:RETURNED:d1",
    );
  });
  it("honours the disabled list", () => {
    expect(isRuleEnabled("invoice.sent", "invoice.sent, estimate.sent")).toBe(false);
    expect(isRuleEnabled("change-order.sent", "invoice.sent")).toBe(true);
  });
});

describe("ensureAutoTask", () => {
  const invoice = {
    invoiceNumber: "INV-0007",
    amount: "1250",
    dueDate: new Date("2026-10-24T12:00:00Z"),
    issueDate: new Date("2026-09-24T12:00:00Z"),
    jobId: "j1",
    job: { jobNumber: "JOB-00005", title: "Wind Trace", projectManagerId: "pm", salesRepId: "rep" },
  };

  it("returns exists and creates nothing when an open task carries the key", async () => {
    db.task.findFirst.mockResolvedValue({ id: "t-open" });
    const r = await ensureAutoTask({ kind: "invoice.sent", invoiceId: "i1" }, "u1");
    expect(r).toEqual({ created: false, taskId: "t-open", reason: "exists" });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("creates when only a closed task carried the key, through createTask inline", async () => {
    db.task.findFirst.mockResolvedValue(null);
    db.invoice.findUnique.mockResolvedValue(invoice);
    const r = await ensureAutoTask({ kind: "invoice.sent", invoiceId: "i1" }, "u1");
    expect(r.created).toBe(true);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Collect payment on INV-0007",
        assignedUserId: "pm",
        invoiceId: "i1",
        jobId: "j1",
        sourceKey: "invoice:SENT:i1",
        source: "auto",
        createdByUserId: "u1",
      }),
      expect.objectContaining({ notify: "inline", actorUserId: "u1" }),
    );
  });

  it("falls back to the oldest office staff when the job has no PM or rep", async () => {
    db.task.findFirst.mockResolvedValue(null);
    db.invoice.findUnique.mockResolvedValue({ ...invoice, job: { ...invoice.job, projectManagerId: null, salesRepId: null } });
    db.user.findFirst.mockResolvedValue({ id: "acct" });
    await ensureAutoTask({ kind: "invoice.sent", invoiceId: "i1" }, "u1");
    expect(createTask.mock.calls[0][0].assignedUserId).toBe("acct");
  });

  it("a disabled kind touches nothing", async () => {
    envRef.TASK_AUTO_RULES_DISABLED = "invoice.sent";
    const r = await ensureAutoTask({ kind: "invoice.sent", invoiceId: "i1" }, "u1");
    expect(r.reason).toBe("disabled");
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  it("reports a missing entity instead of throwing", async () => {
    db.task.findFirst.mockResolvedValue(null);
    db.estimate.findUnique.mockResolvedValue(null);
    const r = await ensureAutoTask({ kind: "estimate.sent", estimateId: "e1" }, "u1");
    expect(r.reason).toBe("entity-missing");
  });

  it("a returned daily log goes HIGH to the submitter, due tomorrow", async () => {
    db.task.findFirst.mockResolvedValue(null);
    db.dailyLog.findUnique.mockResolvedValue({
      logDate: new Date("2026-09-23T12:00:00Z"),
      returnNote: "Missing crew hours",
      managerUserId: "mgr",
      jobId: "j1",
      job: { jobNumber: "JOB-00005", fieldAssignments: [] },
    });
    await ensureAutoTask({ kind: "daily-log.returned", dailyLogId: "d1", crewLeadUserId: "frank" }, "u1");
    const spec = createTask.mock.calls[0][0];
    expect(spec.priority).toBe("HIGH");
    expect(spec.assignedUserId).toBe("frank");
    expect(spec.description).toBe("Missing crew hours");
    expect(spec.dailyLogId).toBe("d1");
  });
});

describe("closeAutoTask", () => {
  it("records nothing when there is nothing open", async () => {
    db.task.findMany.mockResolvedValue([]);
    expect(await closeAutoTask("invoice:SENT:i1", { actorUserId: "u1", outcome: "COMPLETED", because: "paid" })).toEqual({ closed: 0 });
    expect(db.task.updateMany).not.toHaveBeenCalled();
  });
  it("completes open tasks with an AUTO_CLOSED row", async () => {
    db.task.findMany.mockResolvedValue([{ id: "t1" }]);
    const r = await closeAutoTask("invoice:SENT:i1", { actorUserId: "u1", outcome: "COMPLETED", because: "invoice paid" });
    expect(r.closed).toBe(1);
    expect(db.task.updateMany.mock.calls[0][0].data).toMatchObject({ status: "COMPLETED", completedByUserId: "u1" });
    expect(recordTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", type: "AUTO_CLOSED", toValue: "COMPLETED", body: "invoice paid" }),
    );
  });
});

describe("onInvoiceTransition", () => {
  it("SENT raises, PAID completes, VOID cancels, same-status is a no-op", async () => {
    db.task.findFirst.mockResolvedValue({ id: "exists" });
    await onInvoiceTransition("i1", { from: "DRAFT", to: "SENT" }, "u1");
    expect(db.task.findFirst).toHaveBeenCalled();

    db.task.findMany.mockResolvedValue([{ id: "t1" }]);
    await onInvoiceTransition("i1", { from: "SENT", to: "PAID" }, "u1");
    expect(db.task.updateMany.mock.calls.at(-1)?.[0].data.status).toBe("COMPLETED");

    await onInvoiceTransition("i1", { from: "SENT", to: "VOID" }, "u1");
    expect(db.task.updateMany.mock.calls.at(-1)?.[0].data.status).toBe("CANCELLED");

    const before = db.task.updateMany.mock.calls.length;
    await onInvoiceTransition("i1", { from: "PAID", to: "PAID" }, "u1");
    await onInvoiceTransition("i1", null, "u1");
    expect(db.task.updateMany.mock.calls.length).toBe(before);
  });
});
