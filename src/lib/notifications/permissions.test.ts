import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/workflows/visibility", () => ({ visibilityScopeFor: vi.fn() }));

const { splitVisible } = await import("./permissions");

const sets = { all: false, taskIds: new Set(["t1"]), jobIds: new Set(["j1"]), leadIds: new Set(["l1"]), caseIds: new Set(["c1"]) };

describe("splitVisible", () => {
  it("a view-all person keeps everything", () => {
    const rows = [{ id: "a", taskId: "tX", jobId: null, leadId: null, violationCaseId: null }];
    expect(splitVisible(rows, { ...sets, all: true }).visible).toHaveLength(1);
  });
  it("checks the finest subject that is set: task, then case, then job, then lead; subject-less rows pass", () => {
    const rows = [
      { id: "task-ok", taskId: "t1", jobId: "jX", leadId: null, violationCaseId: null },
      { id: "task-no", taskId: "t9", jobId: "j1", leadId: null, violationCaseId: null },
      { id: "case-ok", taskId: null, jobId: null, leadId: "lX", violationCaseId: "c1" },
      { id: "case-no", taskId: null, jobId: "j1", leadId: null, violationCaseId: "c9" },
      { id: "job-ok", taskId: null, jobId: "j1", leadId: null, violationCaseId: null },
      { id: "job-no", taskId: null, jobId: "j9", leadId: "l1", violationCaseId: null },
      { id: "lead-ok", taskId: null, jobId: null, leadId: "l1", violationCaseId: null },
      { id: "none", taskId: null, jobId: null, leadId: null, violationCaseId: null },
    ];
    const { visible, suppressed } = splitVisible(rows, sets);
    expect(visible.map((r) => r.id)).toEqual(["task-ok", "case-ok", "job-ok", "lead-ok", "none"]);
    expect(suppressed.map((r) => r.id)).toEqual(["task-no", "case-no", "job-no"]);
  });
});
