import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  task: { findMany: vi.fn() },
  workflowRoleDefault: { findMany: vi.fn() },
  jobWorkflowTeamMember: { findMany: vi.fn() },
}));
const updateTask = vi.hoisted(() => vi.fn());
const loadSubjectForInstance = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: (...a: unknown[]) => updateTask(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn() } }));
vi.mock("./subject", () => ({
  loadSubject: vi.fn(),
  loadSubjectForInstance: (...a: unknown[]) => loadSubjectForInstance(...a),
}));

const { reassignUnresolved } = await import("./roles");

beforeEach(() => {
  db.workflowRoleDefault.findMany.mockReset().mockResolvedValue([]);
  db.jobWorkflowTeamMember.findMany.mockReset().mockResolvedValue([]);
  loadSubjectForInstance.mockReset().mockResolvedValue({ people: { projectManagerId: "u-pm", salesRepId: null, caseManagerId: null } });
  updateTask.mockReset().mockResolvedValue({});
});

describe("reassignUnresolved", () => {
  it("assigns every open PM step, but only the active ones notify, and they share one batch", async () => {
    db.task.findMany.mockReset().mockResolvedValue([
      { id: "t-active-1", workflowRole: "PROJECT_MANAGER", activatedAt: new Date() },
      { id: "t-active-2", workflowRole: "PROJECT_MANAGER", activatedAt: new Date() },
      { id: "t-waiting", workflowRole: "PROJECT_MANAGER", activatedAt: null },
      { id: "t-nobody", workflowRole: "PERMIT_COORDINATOR", activatedAt: new Date() },
    ]);
    const n = await reassignUnresolved("inst-1", "u-actor");
    expect(n).toBe(3);
    const calls = updateTask.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => [c.id, c.notify])).toEqual([
      ["t-active-1", "after"],
      ["t-active-2", "after"],
      ["t-waiting", "none"],
    ]);
    expect(calls[0].input).toEqual({ assignedUserId: "u-pm" });
    const keys = new Set(calls.map((c) => c.notifyBatch.key));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^wf-reassign:inst-1:\d+$/);
    expect(calls[0].notifyBatch.size).toBe(2);
  });
});
