import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, updateTask, sweepActivation, maybeCompleteInstance, auditCase, recordCaseEvent, recordTaskEvent } = vi.hoisted(() => ({
  db: {
    codeViolationCase: { findUnique: vi.fn(), update: vi.fn() },
    task: { count: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    jobWorkflowInstance: { updateMany: vi.fn() },
  },
  updateTask: vi.fn(),
  sweepActivation: vi.fn(),
  maybeCompleteInstance: vi.fn(),
  auditCase: vi.fn(),
  recordCaseEvent: vi.fn(),
  recordTaskEvent: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/tasks/update", () => ({ updateTask }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent }));
vi.mock("@/lib/workflows/activation", () => ({ sweepActivation, maybeCompleteInstance }));
vi.mock("@/lib/workflows/reconcile", () => ({ ENGINE_SKIP_PREFIX: "Workflow: " }));
vi.mock("./audit", () => ({ auditCase }));
vi.mock("./events", () => ({ recordCaseEvent }));

const { closeCase, reopenCase } = await import("./close");

const actor = { id: "u-admin", role: "ADMIN" as const };

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  for (const fn of [updateTask, sweepActivation, maybeCompleteInstance, auditCase, recordCaseEvent, recordTaskEvent]) fn.mockReset();
  updateTask.mockResolvedValue({});
  sweepActivation.mockResolvedValue([]);
  maybeCompleteInstance.mockResolvedValue({ completed: true });
  db.task.update.mockResolvedValue({});
  db.jobWorkflowInstance.updateMany.mockResolvedValue({ count: 1 });
});

describe("closeCase", () => {
  it("refuses without an override while blockers remain, naming them", async () => {
    db.codeViolationCase.findUnique
      .mockResolvedValueOnce({ status: "ACTIVE", caseNumber: "CV-00001", workflow: { id: "w1" } })
      .mockResolvedValueOnce({ agencyConfirmedAt: null, lienStatus: "NONE", officialBalance: null, fineResolvedAt: null, items: [{ status: "OPEN" }], workflow: { id: "w1" } });
    db.task.count.mockResolvedValue(1);
    await expect(closeCase({ caseId: "c1", actor })).rejects.toMatchObject({ status: 400, detail: { blockers: expect.arrayContaining([expect.objectContaining({ key: "items" }), expect.objectContaining({ key: "agency" }), expect.objectContaining({ key: "steps" })]) } });
    expect(db.codeViolationCase.update).not.toHaveBeenCalled();
  });

  it("with an ADMIN override: engine-skips the open steps, completes the instance, records the override as its own audit action", async () => {
    db.codeViolationCase.findUnique
      .mockResolvedValueOnce({ status: "ACTIVE", caseNumber: "CV-00001", workflow: { id: "w1" } })
      .mockResolvedValueOnce({ agencyConfirmedAt: null, lienStatus: "NONE", officialBalance: null, fineResolvedAt: null, items: [], workflow: { id: "w1" } });
    db.task.count.mockResolvedValue(0);
    db.task.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    db.codeViolationCase.update.mockResolvedValue({ id: "c1", status: "CLOSED" });
    const r = await closeCase({ caseId: "c1", actor, overrideReason: "agency letter is in the mail" });
    expect(r).toMatchObject({ skippedTasks: 2, overridden: true });
    expect(updateTask).toHaveBeenCalledTimes(2);
    expect(updateTask.mock.calls[0][0]).toMatchObject({ id: "t1", input: { status: "CANCELLED", skipReason: "Workflow: case CV-00001 closed" }, notify: "none", internal: { bypassGate: true } });
    expect(maybeCompleteInstance).toHaveBeenCalledWith("w1");
    expect(db.codeViolationCase.update.mock.calls[0][0].data).toMatchObject({ status: "CLOSED", closureOverrideReason: "agency letter is in the mail" });
    expect(auditCase.mock.calls.map((c) => c[0].action)).toEqual(["violation_closed", "violation_closure_override"]);
    expect(auditCase.mock.calls[1][0]).toMatchObject({ reason: "agency letter is in the mail", after: { blockers: ["agency"], actorRole: "ADMIN" } });
  });

  it("with every blocker clear: closes without an override and stores no override reason", async () => {
    db.codeViolationCase.findUnique
      .mockResolvedValueOnce({ status: "COMPLIED", caseNumber: "CV-00002", workflow: null })
      .mockResolvedValueOnce({ agencyConfirmedAt: new Date(), lienStatus: "NONE", officialBalance: null, fineResolvedAt: null, items: [{ status: "VERIFIED" }], workflow: null });
    db.codeViolationCase.update.mockResolvedValue({ id: "c2", status: "CLOSED" });
    const r = await closeCase({ caseId: "c2", actor, reason: "done" });
    expect(r.overridden).toBe(false);
    expect(db.codeViolationCase.update.mock.calls[0][0].data.closureOverrideReason).toBeNull();
    expect(auditCase.mock.calls.map((c) => c[0].action)).toEqual(["violation_closed"]);
  });
});

describe("reopenCase", () => {
  it("reinstates only the steps the closure skipped, resets their activation and re-sweeps", async () => {
    db.codeViolationCase.findUnique.mockResolvedValue({ status: "CLOSED", agencyConfirmedAt: null, workflow: { id: "w1" } });
    db.codeViolationCase.update.mockResolvedValue({ id: "c1", status: "ACTIVE" });
    db.task.findMany.mockResolvedValue([{ id: "t1" }, { id: "t3" }]);
    const r = await reopenCase("c1", "agency reversed itself", actor);
    expect(r.status).toBe("ACTIVE");
    expect(db.task.findMany.mock.calls[0][0].where).toEqual({ workflowInstanceId: "w1", status: "CANCELLED", skipReason: { startsWith: "Workflow: case " } });
    expect(updateTask.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ id: "t1", input: { status: "PENDING", skipReason: null }, notify: "none" }),
      expect.objectContaining({ id: "t3", input: { status: "PENDING", skipReason: null }, notify: "none" }),
    ]);
    expect(db.task.update).toHaveBeenCalledTimes(2);
    expect(db.task.update.mock.calls[0][0]).toEqual({ where: { id: "t1" }, data: { activatedAt: null } });
    expect(db.jobWorkflowInstance.updateMany.mock.calls[0][0]).toEqual({ where: { id: "w1", status: "COMPLETED" }, data: { status: "ACTIVE" } });
    expect(sweepActivation).toHaveBeenCalledWith("w1", "u-admin");
    expect(auditCase.mock.calls[0][0]).toMatchObject({ action: "violation_reopened", after: { status: "ACTIVE", reinstatedTasks: 2 }, reason: "agency reversed itself" });
  });

  it("reopens to COMPLIED when the agency had already confirmed, and refuses an open case", async () => {
    db.codeViolationCase.findUnique.mockResolvedValue({ status: "CLOSED", agencyConfirmedAt: new Date(), workflow: null });
    db.codeViolationCase.update.mockResolvedValue({ id: "c1", status: "COMPLIED" });
    await reopenCase("c1", "x", actor);
    expect(db.codeViolationCase.update.mock.calls[0][0].data.status).toBe("COMPLIED");
    expect(db.task.findMany).not.toHaveBeenCalled();
    db.codeViolationCase.findUnique.mockResolvedValue({ status: "ACTIVE", agencyConfirmedAt: null, workflow: null });
    await expect(reopenCase("c1", "x", actor)).rejects.toMatchObject({ status: 409 });
  });
});
