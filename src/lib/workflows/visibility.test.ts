import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    job: { findUnique: vi.fn(), findMany: vi.fn() },
    codeViolationCase: { findUnique: vi.fn(), findMany: vi.fn() },
    jobWorkflowTeamMember: { findMany: vi.fn() },
    jobFieldAssignment: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

const { taskRightsFor } = await import("./visibility");

const step = { assignedUserId: "u-frank", createdByUserId: "u-admin", jobId: "j1", violationCaseId: null, workflowInstanceId: "w1" };

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  db.job.findUnique.mockResolvedValue({ projectManagerId: "u-pm", workflow: { team: [] }, fieldAssignments: [] });
});

describe("taskRightsFor", () => {
  it("ownership is enough and asks nothing of the database", async () => {
    expect(await taskRightsFor({ id: "u-office", role: "OFFICE_STAFF" }, step)).toEqual({ canEdit: true });
    expect(await taskRightsFor({ id: "u-frank", role: "CREW_LEAD" }, step)).toEqual({ canEdit: true });
    expect(db.job.findUnique).not.toHaveBeenCalled();
  });

  it("the job's project manager may work any step of its workflow, whatever their login role", async () => {
    expect(await taskRightsFor({ id: "u-pm", role: "SALES_REP" }, step)).toEqual({ canEdit: true });
    expect(await taskRightsFor({ id: "u-other", role: "SALES_REP" }, step)).toEqual({ canEdit: false });
  });

  it("a case manager may work the steps of their case", async () => {
    db.codeViolationCase.findUnique.mockResolvedValue({ caseManagerId: "u-cm", workflow: { team: [] } });
    const caseStep = { ...step, jobId: null, violationCaseId: "c1" };
    expect(await taskRightsFor({ id: "u-cm", role: "SALES_REP" }, caseStep)).toEqual({ canEdit: true });
    expect(await taskRightsFor({ id: "u-pm", role: "SALES_REP" }, caseStep)).toEqual({ canEdit: false });
  });

  it("the relationship only reaches workflow tasks, and never lifts read-only", async () => {
    // An ordinary task on the PM's job that someone else owns stays theirs.
    expect(await taskRightsFor({ id: "u-pm", role: "SALES_REP" }, { ...step, workflowInstanceId: null })).toEqual({ canEdit: false });
    expect(await taskRightsFor({ id: "u-pm", role: "READ_ONLY" }, step)).toEqual({ canEdit: false });
  });
});
