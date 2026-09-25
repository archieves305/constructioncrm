import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, createTask, updateTask, recordTaskEvent } = vi.hoisted(() => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    taskDependency: { create: vi.fn() },
    jobPermitInspection: { updateMany: vi.fn() },
    codeViolationInspection: { updateMany: vi.fn() },
    jobWorkflowInstance: { findUnique: vi.fn() },
    workflowRoleDefault: { findMany: vi.fn() },
    jobWorkflowTeamMember: { findMany: vi.fn() },
  },
  createTask: vi.fn(),
  updateTask: vi.fn(),
  recordTaskEvent: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tasks/create", () => ({ createTask }));
vi.mock("@/lib/tasks/update", () => ({ updateTask, TaskUpdateError: class extends Error {} }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent, recordTaskEvents: vi.fn() }));

const { recordInspectionResult } = await import("./inspections");

const step = {
  id: "insp",
  title: "Obtain dry-in inspection if required",
  status: "PENDING",
  jobId: "j1",
  assignedUserId: "u-pc",
  dueLocked: false,
  workflowInstanceId: "w1",
  workflowTaskKey: "roofing:obtain_dry_in_inspection",
  workflowPhaseKey: "roofing:installation",
  workflowModuleKey: "roofing",
  workflowRole: "PERMIT_COORDINATOR",
  workflowSortOrder: 500,
  requiredEvidence: "INSPECTION_RESULT",
  _count: { dependencies: 0 },
};
const actor = { id: "u-me", role: "MANAGER" as const };

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  createTask.mockReset().mockResolvedValue({ id: "corr1" });
  updateTask.mockReset().mockImplementation(async ({ input }: { input: { status: string } }) => ({ task: { status: input.status } }));
  recordTaskEvent.mockReset();
  db.task.findUnique.mockResolvedValue(step);
  db.task.update.mockResolvedValue({});
  // Role context now comes from the instance's owning subject (a job here).
  db.jobWorkflowInstance.findUnique.mockResolvedValue({
    id: "w1",
    appliedAt: new Date(),
    permitStatus: "REQUIRED",
    scopeToggles: {},
    modules: [],
    jobId: "j1",
    violationCaseId: null,
    job: { id: "j1", leadId: "l1", jobNumber: "JOB-00001", createdAt: new Date(), targetStartDate: null, jurisdiction: null, projectManagerId: "u-pm", salesRepId: null },
    violationCase: null,
  });
  db.workflowRoleDefault.findMany.mockResolvedValue([]);
  db.jobWorkflowTeamMember.findMany.mockResolvedValue([{ role: "SUPERINTENDENT", userId: "u-sup" }]);
  db.taskDependency.create.mockResolvedValue({});
});

describe("recordInspectionResult", () => {
  it("PASS records the result and completes the step with the result as its evidence", async () => {
    const r = await recordInspectionResult({ taskId: "insp", result: "PASS", actor });
    expect(db.task.update.mock.calls[0][0].data.inspectionResult).toBe("PASS");
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ input: { status: "COMPLETED" }, internal: { bypassEvidence: true, tickChecklist: true } }));
    expect(createTask).not.toHaveBeenCalled();
    expect(r).toEqual({ status: "COMPLETED", correctionTaskId: null });
  });

  it("FAIL blocks the step, creates a correction task for the superintendent that the step now waits on", async () => {
    const r = await recordInspectionResult({ taskId: "insp", result: "FAIL", notes: "Fastener spacing", actor });
    const created = createTask.mock.calls[0][0];
    expect(created.title).toBe("Correct failed inspection items — Obtain dry-in inspection if required");
    expect(created.assignedUserId).toBe("u-sup");
    expect(created.workflow.taskKey).toBe("roofing:obtain_dry_in_inspection:correction:1");
    expect(created.activatedAt).toBeInstanceOf(Date);
    expect(db.taskDependency.create.mock.calls[0][0].data).toMatchObject({ taskId: "insp", dependsOnTaskId: "corr1", kind: "BLOCKING", source: "workflow" });
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ input: { status: "BLOCKED", blockedReason: "Failed inspection — Fastener spacing" } }));
    expect(r).toEqual({ status: "BLOCKED", correctionTaskId: "corr1" });
  });

  it("CONDITIONAL completes and still raises a correction task, without blocking", async () => {
    const r = await recordInspectionResult({ taskId: "insp", result: "CONDITIONAL", actor });
    expect(createTask.mock.calls[0][0].title).toMatch(/^Complete conditions/);
    expect(db.taskDependency.create).not.toHaveBeenCalled();
    expect(r.status).toBe("COMPLETED");
  });

  it("mirrors to a JobPermitInspection when one is named, and refuses non-inspection steps", async () => {
    await recordInspectionResult({ taskId: "insp", result: "PASS", jobPermitInspectionId: "jpi1", actor });
    expect(db.jobPermitInspection.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "jpi1" }, data: { result: "PASS" } });
    db.task.findUnique.mockResolvedValue({ ...step, requiredEvidence: "PHOTO" });
    await expect(recordInspectionResult({ taskId: "insp", result: "PASS", actor })).rejects.toMatchObject({ status: 400 });
  });
});
