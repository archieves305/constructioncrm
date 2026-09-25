import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    codeViolationCase: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    codeViolationEvent: { create: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { onJobCompleted, syncCorrectiveWorkFromJob } = await import("./job-sync");

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  db.codeViolationEvent.create.mockResolvedValue({});
  db.codeViolationCase.updateMany.mockResolvedValue({ count: 1 });
  db.codeViolationCase.update.mockResolvedValue({});
});

describe("onJobCompleted", () => {
  it("stamps every open, unstamped case linked to the job and writes one event each", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([{ id: "c1", job: { jobNumber: "JOB-00009" } }, { id: "c2", job: { jobNumber: "JOB-00009" } }]);
    const ids = await onJobCompleted("j9", "u-1", "workflow");
    expect(ids).toEqual(["c1", "c2"]);
    expect(db.codeViolationCase.findMany.mock.calls[0][0].where).toEqual({ jobId: "j9", correctiveWorkCompletedAt: null, status: { notIn: ["CLOSED", "CANCELLED"] } });
    expect(db.codeViolationCase.updateMany.mock.calls[0][0].data.correctiveWorkCompletedAt).toBeInstanceOf(Date);
    expect(db.codeViolationEvent.create).toHaveBeenCalledTimes(2);
    expect(db.codeViolationEvent.create.mock.calls[0][0].data).toMatchObject({ caseId: "c1", type: "CORRECTIVE_WORK_COMPLETED", body: "JOB-00009 workflow completed" });
  });

  it("is a no-op for a job with no cases and never throws", async () => {
    db.codeViolationCase.findMany.mockResolvedValue([]);
    expect(await onJobCompleted("j1", null, "stage")).toEqual([]);
    expect(db.codeViolationCase.updateMany).not.toHaveBeenCalled();
    db.codeViolationCase.findMany.mockRejectedValue(new Error("db down"));
    expect(await onJobCompleted("j1", null, "stage")).toEqual([]);
  });
});

describe("syncCorrectiveWorkFromJob", () => {
  it("stamps when the linked job is already complete, and only then", async () => {
    db.codeViolationCase.findUnique.mockResolvedValue({ correctiveWorkCompletedAt: null, job: { id: "j1", jobNumber: "JOB-1", currentStage: { isClosed: false }, workflow: { status: "COMPLETED" } } });
    expect(await syncCorrectiveWorkFromJob("c1", "u")).toBe(true);
    db.codeViolationCase.findUnique.mockResolvedValue({ correctiveWorkCompletedAt: null, job: { id: "j1", jobNumber: "JOB-1", currentStage: { isClosed: false }, workflow: { status: "ACTIVE" } } });
    expect(await syncCorrectiveWorkFromJob("c1", "u")).toBe(false);
    db.codeViolationCase.findUnique.mockResolvedValue({ correctiveWorkCompletedAt: new Date(), job: { id: "j1", jobNumber: "JOB-1", currentStage: { isClosed: true }, workflow: null } });
    expect(await syncCorrectiveWorkFromJob("c1", "u")).toBe(false);
  });
});
