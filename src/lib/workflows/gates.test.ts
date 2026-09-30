import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, updateTask, checkEvidence, recordTaskEvent } = vi.hoisted(() => ({
  db: { task: { findMany: vi.fn() }, jobWorkflowInstance: { findMany: vi.fn(), findUnique: vi.fn() } },
  updateTask: vi.fn(),
  checkEvidence: vi.fn(),
  recordTaskEvent: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/tasks/update", () => ({ updateTask }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent }));
vi.mock("./evidence", async (orig) => ({ ...(await orig<typeof import("./evidence")>()), checkEvidence }));

const { completeSatisfiedGates, settleCaseGates, settleJobGates, SELF_COMPLETING_GATES } = await import("./gates");

const gate = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  jobId: "j1",
  violationCaseId: null,
  workflowInstanceId: "w1",
  requiredEvidence: "PAYMENT_STATUS",
  requiredEvidenceParam: "DEPOSIT",
  checklist: null,
  inspectionResult: null,
  ...extra,
});

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  updateTask.mockReset().mockResolvedValue({});
  checkEvidence.mockReset();
  recordTaskEvent.mockReset();
});

describe("completeSatisfiedGates", () => {
  it("completes an active gate whose record is on file, quietly, with the reason on its timeline", async () => {
    db.task.findMany.mockResolvedValueOnce([gate("dep")]).mockResolvedValueOnce([]);
    checkEvidence.mockResolvedValue({ ok: true });
    expect(await completeSatisfiedGates("w1", "u1")).toEqual(["dep"]);
    expect(updateTask).toHaveBeenCalledWith({ id: "dep", input: { status: "COMPLETED" }, actorUserId: "u1", notify: "none" });
    expect(recordTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ taskId: "dep", type: "AUTO_CLOSED", toValue: "COMPLETED" }));
  });

  it("only looks at active, open record gates — never an inspection, a linked-job judgement or Close case", async () => {
    db.task.findMany.mockResolvedValue([]);
    await completeSatisfiedGates("w1", "u1");
    const where = db.task.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ workflowInstanceId: "w1", status: { in: ["PENDING", "IN_PROGRESS"] }, activatedAt: { not: null } });
    expect(where.NOT).toEqual({ workflowTaskKey: { endsWith: ":close_case" } });
    expect(SELF_COMPLETING_GATES.has("INSPECTION_RESULT")).toBe(false);
    expect(SELF_COMPLETING_GATES.has("LINKED_JOB")).toBe(false);
    expect(SELF_COMPLETING_GATES.has("PHOTO")).toBe(false);
    expect(where.requiredEvidence.in.sort()).toEqual(Array.from(SELF_COMPLETING_GATES).sort());
  });

  it("leaves a gate whose record is missing, or whose checklist has a line left", async () => {
    db.task.findMany.mockResolvedValue([gate("dep"), gate("permit", { requiredEvidence: "PERMIT_NUMBER", checklist: [{ key: "item_1", label: "Plans saved", done: false }] })]);
    checkEvidence.mockResolvedValue({ ok: false, hint: "payment", message: "Record the deposit first" });
    expect(await completeSatisfiedGates("w1", "u1")).toEqual([]);
    expect(updateTask).not.toHaveBeenCalled();
    // The checklist gate was never even checked against its record.
    expect(checkEvidence).toHaveBeenCalledTimes(1);
  });

  it("follows a chain: a gate that completing the first one woke is settled in the next round", async () => {
    db.task.findMany.mockResolvedValueOnce([gate("a")]).mockResolvedValueOnce([gate("b")]).mockResolvedValueOnce([]);
    checkEvidence.mockResolvedValue({ ok: true });
    expect(await completeSatisfiedGates("w1", "u1")).toEqual(["a", "b"]);
  });

  it("never throws", async () => {
    db.task.findMany.mockRejectedValue(new Error("db down"));
    expect(await completeSatisfiedGates("w1", "u1")).toEqual([]);
  });
});

describe("settling after a write", () => {
  it("a job write settles the job's workflow and any case it is the corrective job for", async () => {
    db.jobWorkflowInstance.findMany.mockResolvedValue([{ id: "w-job" }, { id: "w-case" }]);
    db.task.findMany.mockResolvedValue([]);
    await settleJobGates("j1", "u1");
    expect(db.jobWorkflowInstance.findMany.mock.calls[0]![0].where).toEqual({ status: "ACTIVE", OR: [{ jobId: "j1" }, { violationCase: { jobId: "j1" } }] });
    expect(db.task.findMany.mock.calls.map((c) => c[0].where.workflowInstanceId)).toEqual(["w-job", "w-case"]);
  });

  it("a case with no active workflow is left alone", async () => {
    db.jobWorkflowInstance.findUnique.mockResolvedValue({ id: "w1", status: "COMPLETED" });
    expect(await settleCaseGates("c1", "u1")).toBe(0);
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
});
