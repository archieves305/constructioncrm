import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, createTask, recordInspectionResult, closePermitIfFinalPassed, settleJobGates, InspectionError } = vi.hoisted(() => ({
  db: {
    jobPermit: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    jobPermitInspection: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn() },
    activityLog: { create: vi.fn() },
  },
  createTask: vi.fn(),
  recordInspectionResult: vi.fn(),
  closePermitIfFinalPassed: vi.fn(),
  settleJobGates: vi.fn(),
  InspectionError: class extends Error {},
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/follow-ups/permit-events", () => ({ emitInspectionEvent: vi.fn(), emitPermitEvent: vi.fn(), resultEventName: () => null, statusEventName: () => null }));
vi.mock("@/lib/tasks/create", () => ({ createTask }));
vi.mock("@/lib/workflows/gates", () => ({ settleJobGates }));
vi.mock("@/lib/workflows/inspections", () => ({ recordInspectionResult, InspectionError }));
vi.mock("@/lib/workflows/roles", () => ({ userForJobRole: vi.fn(async () => "u-sup") }));
vi.mock("./effects", () => ({ closePermitIfFinalPassed }));

const { PermitError, recordPermitInspectionResult, updatePermit, updatePermitInspection } = await import("./service");

const actor = { id: "u-me", role: "MANAGER" as const };
const row = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  type: "ROOFING_IN_PROGRESS",
  result: "SCHEDULED",
  notes: null,
  taskId: null,
  permit: { id: "p1", jobId: "j1", permitType: "Re-roof", assignedUserId: "u-pc", job: { leadId: "l1", projectManagerId: "u-pm" } },
  ...over,
});
const dryIn = { id: "t-dry", title: "Dry-in inspection", status: "PENDING", workflowTaskKey: "roofing:dry_in_inspection", workflowSortOrder: 420 };
const final = { id: "t-final", title: "Final inspection passed", status: "PENDING", workflowTaskKey: "core:obtain_final_inspection", workflowSortOrder: 900 };

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  for (const fn of [createTask, recordInspectionResult, closePermitIfFinalPassed, settleJobGates]) fn.mockReset();
  db.jobPermitInspection.findUnique.mockResolvedValue(row());
  db.jobPermitInspection.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "i1", taskId: null, ...data }));
  db.task.findMany.mockResolvedValue([dryIn, final]);
  db.task.findFirst.mockResolvedValue(null);
  db.jobPermit.count.mockResolvedValue(1);
  closePermitIfFinalPassed.mockResolvedValue(null);
  createTask.mockResolvedValue({ id: "corr-standalone" });
  recordInspectionResult.mockResolvedValue({ status: "BLOCKED", correctionTaskId: "corr-wf", jobPermitInspectionId: "i1" });
});

describe("recordPermitInspectionResult", () => {
  it("a failure runs the workflow path on the matching step: blocked, with its correction task", async () => {
    const r = await recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", notes: "Nailing pattern", actor });
    expect(recordInspectionResult).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t-dry", result: "FAIL", notes: "Nailing pattern", jobPermitInspectionId: "i1" }));
    expect(createTask).not.toHaveBeenCalled();
    expect(r.workflow).toEqual({ taskId: "t-dry", applied: true, stepStatus: "BLOCKED", correctionTaskId: "corr-wf" });
    expect(settleJobGates).toHaveBeenCalledWith("j1", "u-me");
  });

  it("a failure on a job with no step for it still raises a correction task", async () => {
    db.task.findMany.mockResolvedValue([]);
    const r = await recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", notes: "Missing flashing", actor });
    expect(recordInspectionResult).not.toHaveBeenCalled();
    expect(createTask.mock.calls[0][0]).toMatchObject({ jobId: "j1", priority: "HIGH", assignedUserId: "u-sup", sourceKey: "permit-inspection:i1:correction", description: "Inspector notes: Missing flashing" });
    expect(createTask.mock.calls[0][0].title).toMatch(/^Correct failed inspection items — roofing in progress inspection \(Re-roof permit\)/);
    expect(r.workflow).toMatchObject({ taskId: null, applied: false, correctionTaskId: "corr-standalone" });
  });

  it("does not raise a second correction for the same inspection while one is open", async () => {
    db.task.findMany.mockResolvedValue([]);
    db.task.findFirst.mockResolvedValue({ id: "corr-open" });
    const r = await recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", actor });
    expect(createTask).not.toHaveBeenCalled();
    expect(r.workflow.correctionTaskId).toBe("corr-open");
  });

  it("a passed final finishes the final step only once every permit is closed", async () => {
    db.jobPermitInspection.findUnique.mockResolvedValue(row({ type: "FINAL" }));
    await recordPermitInspectionResult({ inspectionId: "i1", result: "PASS", actor });
    expect(recordInspectionResult).not.toHaveBeenCalled();
    // Linked to the step all the same, so the step shows what was passed.
    expect(db.jobPermitInspection.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: { taskId: "t-final" } });

    db.jobPermit.count.mockResolvedValue(0);
    closePermitIfFinalPassed.mockResolvedValue("j1");
    recordInspectionResult.mockResolvedValue({ status: "COMPLETED", correctionTaskId: null, jobPermitInspectionId: "i1" });
    const r = await recordPermitInspectionResult({ inspectionId: "i1", result: "PASS", actor });
    expect(recordInspectionResult).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t-final", result: "PASS" }));
    expect(r).toMatchObject({ permitClosed: true, workflow: { applied: true, stepStatus: "COMPLETED" } });
  });

  it("a pass with no step says nothing to the workflow and raises nothing", async () => {
    db.task.findMany.mockResolvedValue([]);
    const r = await recordPermitInspectionResult({ inspectionId: "i1", result: "PASS", actor });
    expect(createTask).not.toHaveBeenCalled();
    expect(r.workflow).toEqual({ taskId: null, applied: false, stepStatus: null, correctionTaskId: null });
  });

  it("honours a named step, 'no step', and refuses a step that is not on the job", async () => {
    await recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", taskId: "t-final", actor });
    expect(recordInspectionResult).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "t-final" }));
    recordInspectionResult.mockClear();
    await recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", taskId: null, actor });
    expect(recordInspectionResult).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledTimes(1);
    await expect(recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", taskId: "elsewhere", actor })).rejects.toBeInstanceOf(PermitError);
  });

  it("falls back to a correction task when the step will not take the result", async () => {
    recordInspectionResult.mockRejectedValue(new InspectionError("This step is already closed"));
    const r = await recordPermitInspectionResult({ inspectionId: "i1", result: "FAIL", actor });
    expect(r.workflow).toMatchObject({ taskId: "t-dry", applied: false, correctionTaskId: "corr-standalone" });
  });
});

describe("updatePermitInspection", () => {
  it("routes a new pass / fail through the result path and leaves plain edits alone", async () => {
    db.jobPermitInspection.findUnique.mockResolvedValueOnce({ result: "SCHEDULED" });
    await updatePermitInspection("i1", { result: "FAIL", notes: "x" }, actor);
    expect(recordInspectionResult).toHaveBeenCalled();

    recordInspectionResult.mockClear();
    db.jobPermitInspection.findUnique.mockResolvedValueOnce({ result: "FAIL" });
    const r = await updatePermitInspection("i1", { result: "FAIL", notes: "more detail" }, actor);
    expect(recordInspectionResult).not.toHaveBeenCalled();
    expect(r.workflow).toBeNull();
  });

  it("refuses an unknown type, result or date", async () => {
    db.jobPermitInspection.findUnique.mockResolvedValue({ result: "SCHEDULED" });
    await expect(updatePermitInspection("i1", { result: "MAYBE" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(updatePermitInspection("i1", { type: "SEPTIC" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(updatePermitInspection("i1", { scheduledFor: "soon" }, actor)).rejects.toMatchObject({ status: 400 });
  });
});

describe("updatePermit", () => {
  const permit = { status: "APPLIED", approvedDate: null, finalPassedDate: null, jobId: "j1" };
  beforeEach(() => {
    db.jobPermit.findUnique.mockResolvedValue(permit);
    db.jobPermit.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "p1", jobId: "j1", job: { id: "j1", jobNumber: "JOB-1", leadId: "l1" }, ...data }));
  });

  it("stamps the issue date when the status moves to Issued, and settles the gates", async () => {
    await updatePermit("p1", { status: "ISSUED" }, actor);
    expect(db.jobPermit.update.mock.calls[0][0].data.approvedDate).toBeInstanceOf(Date);
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
    expect(settleJobGates).toHaveBeenCalledWith("j1", "u-me");
  });

  it("keeps a date sent in the same save and stamps nothing on a same-status save", async () => {
    await updatePermit("p1", { status: "ISSUED", approvedDate: "2026-09-20" }, actor);
    expect(db.jobPermit.update.mock.calls[0][0].data.approvedDate).toEqual(new Date("2026-09-20"));
    db.jobPermit.update.mockClear();
    db.activityLog.create.mockClear();
    await updatePermit("p1", { status: "APPLIED", notes: "called the city" }, actor);
    expect(db.jobPermit.update.mock.calls[0][0].data.approvedDate).toBeUndefined();
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });

  it("refuses a bad status, a bad fee and an empty jurisdiction; 404s a missing permit", async () => {
    await expect(updatePermit("p1", { status: "DONE" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(updatePermit("p1", { permitFee: "abc" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(updatePermit("p1", { municipality: " " }, actor)).rejects.toMatchObject({ status: 400 });
    db.jobPermit.findUnique.mockResolvedValue(null);
    await expect(updatePermit("p1", {}, actor)).rejects.toMatchObject({ status: 404 });
  });
});
