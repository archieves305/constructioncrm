import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));

const R = await import("./reports");
import type { ReportInstance, ReportTask } from "./reports";
import type { JobWorkflowSummary, SummaryPhase } from "./summary";

const d = (s: string) => new Date(s);
const now = d("2026-09-24T12:00:00Z");

function inst(over: Partial<ReportInstance> = {}): ReportInstance {
  const phases = new Map<string, SummaryPhase>([
    ["core:job_setup", { key: "core:job_setup", name: "Job Setup", band: 100, sortOrder: 0 }],
    ["roofing:permitting", { key: "roofing:permitting", name: "Permitting", band: 400, sortOrder: 0 }],
    ["roofing:procurement", { key: "roofing:procurement", name: "Procurement", band: 500, sortOrder: 0 }],
    ["core:production", { key: "core:production", name: "Production", band: 700, sortOrder: 0 }],
  ]);
  return {
    id: "i1",
    jobId: "j1",
    jobNumber: "JOB-00001",
    jobTitle: "Roof",
    status: "ACTIVE",
    permitStatus: "REQUIRED",
    appliedAt: d("2026-09-01T00:00:00Z"),
    jobCreatedAt: d("2026-08-30T00:00:00Z"),
    modules: [
      { key: "core", name: "Core Construction", kind: "CORE", trade: null, index: 0 },
      { key: "roofing", name: "Roofing", kind: "TRADE", trade: "Roofing", index: 1 },
    ],
    phases,
    ...over,
  };
}

let n = 0;
function task(over: Partial<ReportTask>): ReportTask {
  n++;
  return {
    id: `t${n}`,
    workflowInstanceId: "i1",
    workflowTaskKey: `core:step_${n}`,
    workflowPhaseKey: "core:job_setup",
    workflowModuleKey: "core",
    workflowRole: "PROJECT_MANAGER",
    title: `Step ${n}`,
    status: "PENDING",
    activatedAt: d("2026-09-02T00:00:00Z"),
    completedAt: null,
    dueAt: null,
    assignedUserId: "u1",
    skipReason: null,
    inspectionResult: null,
    requiredEvidence: null,
    ...over,
  };
}
const done = (activated: string, completed: string, over: Partial<ReportTask> = {}) =>
  task({ status: "COMPLETED", activatedAt: d(activated), completedAt: d(completed), ...over });

describe("durationStats", () => {
  it("handles empty, odd and even sets", () => {
    expect(R.durationStats([])).toEqual({ n: 0, avgDays: null, medianDays: null, p90Days: null });
    expect(R.durationStats([1, 3, 2])).toEqual({ n: 3, avgDays: 2, medianDays: 2, p90Days: 3 });
    expect(R.durationStats([1, 2, 3, 4])).toEqual({ n: 4, avgDays: 2.5, medianDays: 2.5, p90Days: 4 });
  });
});

describe("durationsByTrade / durationsByPhase", () => {
  const instances = new Map([["i1", inst()]]);
  const tasks = [
    done("2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z"), // core 2d
    done("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"), // core 4d
    done("2026-09-01T00:00:00Z", "2026-09-11T00:00:00Z", { workflowModuleKey: "roofing", workflowTaskKey: "roofing:a", workflowPhaseKey: "roofing:permitting" }), // 10d
    task({ status: "PENDING", workflowModuleKey: "roofing", workflowTaskKey: "roofing:b", workflowPhaseKey: "roofing:permitting" }), // open: no duration, phase still open
    done("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", { workflowTaskKey: null }), // manual: ignored
  ];

  it("groups step durations by module, Core first", () => {
    expect(R.durationsByTrade(tasks, instances)).toEqual([
      { key: "core", name: "Core Construction", n: 2, avgDays: 3, medianDays: 3, p90Days: 4 },
      { key: "roofing", name: "Roofing", n: 1, avgDays: 10, medianDays: 10, p90Days: 10 },
    ]);
  });

  it("phase rows carry step stats and a cycle only once the phase has closed", () => {
    const rows = R.durationsByPhase(tasks, instances);
    expect(rows.map((r) => r.key)).toEqual(["core:job_setup", "roofing:permitting"]);
    expect(rows[0]).toMatchObject({ name: "Job Setup", band: 100, steps: { n: 2, avgDays: 3 }, cycle: { n: 1, avgDays: 4 } });
    expect(rows[1]).toMatchObject({ name: "Permitting", steps: { n: 1 }, cycle: { n: 0 } });
  });
});

describe("overdueByRole", () => {
  it("counts active open steps past due per role, with unassigned and age", () => {
    const rows = R.overdueByRole(
      [
        task({ dueAt: d("2026-09-20T12:00:00Z") }), // PM 4d
        task({ dueAt: d("2026-09-22T12:00:00Z"), assignedUserId: null }), // PM 2d unassigned
        task({ dueAt: d("2026-09-14T12:00:00Z"), workflowRole: "PERMIT_COORDINATOR", status: "BLOCKED" }), // PC 10d
        task({ dueAt: d("2026-09-14T12:00:00Z"), activatedAt: null }), // not active
        task({ dueAt: d("2026-09-30T12:00:00Z") }), // future
        task({ dueAt: d("2026-09-14T12:00:00Z"), status: "COMPLETED" }),
      ],
      now,
    );
    expect(rows).toEqual([
      { role: "PROJECT_MANAGER", label: "Project manager", count: 2, unassigned: 1, avgDaysOverdue: 3, maxDaysOverdue: 4 },
      { role: "PERMIT_COORDINATOR", label: "Permit coordinator", count: 1, unassigned: 0, avgDaysOverdue: 10, maxDaysOverdue: 10 },
    ]);
  });
});

describe("classifyDelayCause", () => {
  const base = { workflowTaskKey: "roofing:x", requiredEvidence: null, inspectionResult: null, assignedUserId: "u1", title: "x" } as const;
  const ctx = { phaseBand: 100, permitStatus: "REQUIRED" as const };
  it("orders the causes", () => {
    expect(R.classifyDelayCause({ ...base, inspectionResult: "FAIL" }, ctx)).toBe("FAILED_INSPECTION");
    expect(R.classifyDelayCause({ ...base, workflowTaskKey: "core:determine_permit_requirement" }, { ...ctx, permitStatus: "UNDETERMINED" })).toBe("PERMIT_UNDETERMINED");
    expect(R.classifyDelayCause({ ...base, workflowTaskKey: "core:determine_permit_requirement" }, ctx)).toBe("PERMIT");
    expect(R.classifyDelayCause({ ...base, requiredEvidence: "PERMIT_NUMBER" }, ctx)).toBe("PERMIT");
    expect(R.classifyDelayCause({ ...base, requiredEvidence: "INSPECTION_RESULT" }, ctx)).toBe("INSPECTION");
    expect(R.classifyDelayCause({ ...base, workflowTaskKey: "roofing:obtain_dry_in_inspection" }, ctx)).toBe("INSPECTION");
    expect(R.classifyDelayCause(base, { ...ctx, phaseBand: 400 })).toBe("PERMIT");
    expect(R.classifyDelayCause({ ...base, requiredEvidence: "PAYMENT_STATUS" }, ctx)).toBe("PAYMENT");
    expect(R.classifyDelayCause(base, { ...ctx, phaseBand: 500 })).toBe("PROCUREMENT");
    expect(R.classifyDelayCause({ ...base, assignedUserId: null }, ctx)).toBe("UNASSIGNED");
    expect(R.classifyDelayCause(base, ctx)).toBe("OTHER");
  });
});

describe("stalledSteps", () => {
  it("classifies blocked and overdue active steps and ranks blocked first", () => {
    const instances = new Map([["i1", inst({ permitStatus: "UNDETERMINED" })]]);
    const out = R.stalledSteps(
      [
        task({ workflowTaskKey: "core:determine_permit_requirement", dueAt: d("2026-09-10T00:00:00Z") }),
        task({ status: "BLOCKED", inspectionResult: "FAIL", workflowPhaseKey: "core:production" }),
        task({ workflowPhaseKey: "roofing:procurement", dueAt: d("2026-09-23T00:00:00Z") }),
        task({ dueAt: d("2026-09-23T00:00:00Z"), activatedAt: null }), // waiting, not stalled
        task({ dueAt: d("2026-09-30T00:00:00Z") }),
      ],
      instances,
      now,
    );
    expect(out.byCause).toEqual([
      { cause: "FAILED_INSPECTION", label: "Failed inspection", blocked: 1, overdue: 0, jobs: 1 },
      { cause: "PERMIT_UNDETERMINED", label: "Permit undetermined", blocked: 0, overdue: 1, jobs: 1 },
      { cause: "PROCUREMENT", label: "Procurement", blocked: 0, overdue: 1, jobs: 1 },
    ]);
    expect(out.items.map((i) => [i.state, i.cause])).toEqual([
      ["BLOCKED", "FAILED_INSPECTION"],
      ["OVERDUE", "PERMIT_UNDETERMINED"],
      ["OVERDUE", "PROCUREMENT"],
    ]);
    expect(out.items[1]).toMatchObject({ jobNumber: "JOB-00001", daysOverdue: 14.5, assigned: true });
  });
});

describe("leadTimes", () => {
  it("measures created→applied, applied→production start (per trade) and the permit cycle", () => {
    const instances = new Map([["i1", inst()], ["i2", inst({ id: "i2", jobId: "j2", jobNumber: "JOB-00002", jobCreatedAt: d("2026-08-01T00:00:00Z"), appliedAt: d("2026-08-11T00:00:00Z") })]]);
    const tasks = [
      done("2026-09-01T00:00:00Z", "2026-09-06T00:00:00Z", { workflowTaskKey: "core:confirm_production_start" }), // i1: 5d after applied
      done("2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z", { workflowTaskKey: "core:determine_permit_requirement" }),
      done("2026-09-03T00:00:00Z", "2026-09-13T00:00:00Z", { workflowTaskKey: "roofing:confirm_permit_issued", workflowModuleKey: "roofing" }), // 10d permit cycle
      done("2026-08-11T00:00:00Z", "2026-08-12T00:00:00Z", { workflowInstanceId: "i2", workflowTaskKey: "core:determine_permit_requirement" }), // i2: decided, never issued
    ];
    const lt = R.leadTimes(tasks, instances);
    expect(lt.overall).toEqual([
      { metric: "createdToApplied", label: "Job created → workflow applied", n: 2, avgDays: 6, medianDays: 6, p90Days: 10 },
      { metric: "appliedToProductionStart", label: "Applied → production start confirmed", n: 1, avgDays: 5, medianDays: 5, p90Days: 5 },
      { metric: "permitCycle", label: "Permit decided → permit issued", n: 1, avgDays: 10, medianDays: 10, p90Days: 10 },
    ]);
    expect(lt.productionStartByTrade).toEqual([{ key: "roofing", name: "Roofing", n: 1, avgDays: 5, medianDays: 5, p90Days: 5 }]);
  });
});

describe("mostSkipped", () => {
  it("separates people's skips from engine skips and ranks by people's", () => {
    const rows = R.mostSkipped([
      task({ status: "CANCELLED", skipReason: "Customer supplied", workflowTaskKey: "roofing:order_materials", title: "Order materials" }),
      task({ status: "CANCELLED", skipReason: "Not needed", workflowTaskKey: "roofing:order_materials", title: "Order materials" }),
      task({ status: "CANCELLED", skipReason: "Workflow: scope changed — this step is no longer included", workflowTaskKey: "roofing:tear_off", title: "Tear off" }),
      task({ status: "CANCELLED", skipReason: "Workflow: scope changed — this step is no longer included", workflowTaskKey: "roofing:tear_off", title: "Tear off" }),
      task({ status: "CANCELLED", skipReason: "Workflow: scope changed — this step is no longer included", workflowTaskKey: "roofing:tear_off", title: "Tear off" }),
      task({ status: "CANCELLED", skipReason: null, workflowTaskKey: null, title: "Manual" }),
      task({ status: "COMPLETED", skipReason: "stale", workflowTaskKey: "roofing:x" }),
    ]);
    expect(rows).toEqual([
      { key: "roofing:order_materials", title: "Order materials", count: 2, userSkips: 2, engineSkips: 0, lastReason: "Not needed" },
      { key: "roofing:tear_off", title: "Tear off", count: 3, userSkips: 0, engineSkips: 3, lastReason: null },
    ]);
  });
});

describe("buildWorkflowReport", () => {
  it("assembles the summary tiles from active steps", () => {
    const instances = new Map([["i1", inst({ permitStatus: "UNDETERMINED" })], ["i2", inst({ id: "i2", jobId: "j2", status: "COMPLETED" })]]);
    const report = R.buildWorkflowReport(
      instances,
      [
        task({ dueAt: d("2026-09-01T00:00:00Z"), assignedUserId: null }),
        task({ status: "BLOCKED", inspectionResult: "FAIL" }),
        task({ activatedAt: null }),
        task({ status: "COMPLETED", completedAt: now }),
      ],
      now,
    );
    expect(report.summary).toEqual({
      workflows: 2,
      active: 1,
      completed: 1,
      stepsOpen: 3,
      stepsReady: 1,
      stepsOverdue: 1,
      stepsBlocked: 1,
      stepsUnassigned: 1,
      failedInspections: 1,
      permitsUndetermined: 1,
    });
    expect(report.range).toEqual({ from: null, to: null });
  });
});

describe("buildWorkflowHealth", () => {
  const summary = (over: Partial<JobWorkflowSummary>): JobWorkflowSummary => ({
    instanceId: "i",
    status: "ACTIVE",
    permitStatus: "REQUIRED",
    trades: [],
    currentPhase: { key: "core:job_setup", name: "Job Setup", moduleKey: "core", band: 100 },
    total: 10,
    done: 2,
    skipped: 0,
    open: 8,
    ready: 3,
    blocked: 0,
    failedInspections: 0,
    overdue: 0,
    unassigned: 0,
    percentComplete: 20,
    ...over,
  });
  it("totals active workflows and ranks the jobs that need attention", () => {
    const jobs = [
      { id: "a", jobNumber: "JOB-1", title: "A", customer: "Ann" },
      { id: "b", jobNumber: "JOB-2", title: "B", customer: "Bo" },
      { id: "c", jobNumber: "JOB-3", title: "C", customer: null },
      { id: "d", jobNumber: "JOB-4", title: "D", customer: null },
    ];
    const summaries = new Map<string, JobWorkflowSummary>([
      ["a", summary({ overdue: 2, permitStatus: "UNDETERMINED" })],
      ["b", summary({ blocked: 1, failedInspections: 1, unassigned: 1 })],
      ["c", summary({ status: "COMPLETED", overdue: 5 })],
      ["d", summary({})],
    ]);
    const h = R.buildWorkflowHealth(jobs, summaries, now, 1);
    expect(h).toMatchObject({ active: 3, stepsReady: 9, stepsOverdue: 2, stepsBlocked: 1, stepsUnassigned: 1, failedInspections: 1, permitsUndetermined: 1, jobsWithIssues: 2 });
    expect(h.attention).toEqual([
      { jobId: "a", jobNumber: "JOB-1", title: "A", customer: "Ann", currentPhase: "Job Setup", percentComplete: 20, overdue: 2, blocked: 0, unassigned: 0, permitStatus: "UNDETERMINED" },
    ]);
  });
});
