import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, recordTaskEvent, onTaskTransition } = vi.hoisted(() => ({
  db: {
    jobWorkflowInstance: { findUnique: vi.fn() },
    jobTaskTemplate: { findMany: vi.fn() },
    task: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  recordTaskEvent: vi.fn(),
  onTaskTransition: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent }));
vi.mock("@/lib/tasks/transitions", () => ({ onTaskTransition }));

const { closeSupersededTasks, findSupersededTasks, jobHasActiveWorkflow, workflowCoversRuleTask } = await import("./duplicates");

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  recordTaskEvent.mockReset();
  onTaskTransition.mockReset();
});

describe("jobHasActiveWorkflow", () => {
  it("is true only for an ACTIVE workflow on that job", async () => {
    expect(await jobHasActiveWorkflow(null)).toBe(false);
    expect(db.jobWorkflowInstance.findUnique).not.toHaveBeenCalled();
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce(null);
    expect(await jobHasActiveWorkflow("j1")).toBe(false);
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce({ status: "COMPLETED" });
    expect(await jobHasActiveWorkflow("j1")).toBe(false);
    db.jobWorkflowInstance.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    expect(await jobHasActiveWorkflow("j1")).toBe(true);
  });
});

describe("workflowCoversRuleTask", () => {
  it("stands down only the two permit rule tasks the workflow carries, and only on a workflow job", async () => {
    db.jobWorkflowInstance.findUnique.mockResolvedValue({ status: "ACTIVE" });
    expect(await workflowCoversRuleTask("Permit Issued: Schedule Install Task", "j1")).toBe(true);
    expect(await workflowCoversRuleTask("Permit Final: Office Close-Out Task", "j1")).toBe(true);
    // Follow-ups the workflow dropped its own steps in favour of keep running.
    expect(await workflowCoversRuleTask("Permit Aging 7d: Coordinator Follow-Up Task", "j1")).toBe(false);
    expect(await workflowCoversRuleTask("Inspection Failed: Reschedule + Remediate Task", "j1")).toBe(false);
    db.jobWorkflowInstance.findUnique.mockResolvedValue(null);
    expect(await workflowCoversRuleTask("Permit Issued: Schedule Install Task", "j1")).toBe(false);
    expect(await workflowCoversRuleTask("Permit Issued: Schedule Install Task", null)).toBe(false);
  });
});

describe("superseded tasks", () => {
  it("finds the deposit task and the marked stage tasks — open, on this job, never a workflow step", async () => {
    db.jobTaskTemplate.findMany.mockResolvedValue([{ title: "Order materials" }, { title: "Order materials" }, { title: "Collect final payment" }]);
    db.task.findMany.mockResolvedValue([{ id: "t1", title: "Collect deposit — 12 Main St" }]);
    expect(await findSupersededTasks("j1")).toEqual([{ taskId: "t1", title: "Collect deposit — 12 Main St" }]);
    const where = db.task.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ jobId: "j1", workflowInstanceId: null, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } });
    expect(where.OR).toEqual([
      { events: { some: { type: "CREATED", toValue: "job_deposit" } } },
      { title: { in: ["Order materials", "Collect final payment"] }, events: { some: { type: "CREATED", toValue: "stage_template" } } },
    ]);
  });

  it("with no marked stage template, only the deposit task qualifies", async () => {
    db.jobTaskTemplate.findMany.mockResolvedValue([]);
    db.task.findMany.mockResolvedValue([]);
    await findSupersededTasks("j1");
    expect(db.task.findMany.mock.calls[0]![0].where.OR).toEqual([{ events: { some: { type: "CREATED", toValue: "job_deposit" } } }]);
  });

  it("cancels them with the reason on the timeline, and never throws", async () => {
    db.jobTaskTemplate.findMany.mockResolvedValue([]);
    db.task.findMany.mockResolvedValueOnce([{ id: "t1", title: "Collect deposit" }]).mockResolvedValueOnce([{ id: "t1", status: "PENDING" }]);
    expect(await closeSupersededTasks("j1", "u1")).toBe(1);
    expect(db.task.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["t1"] } }, data: { status: "CANCELLED", blockedReason: null } });
    expect(recordTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", type: "AUTO_CLOSED", toValue: "CANCELLED" }));
    expect(onTaskTransition).toHaveBeenCalledWith({ taskId: "t1", from: "PENDING", to: "CANCELLED", actorUserId: "u1" });

    db.task.findMany.mockReset();
    db.task.findMany.mockRejectedValue(new Error("db down"));
    expect(await closeSupersededTasks("j1", "u1")).toBe(0);
  });
});
