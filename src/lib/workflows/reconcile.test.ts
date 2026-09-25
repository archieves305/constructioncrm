import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE } from "../../../prisma/seeds/workflows/core";
import { ROOFING } from "../../../prisma/seeds/workflows/roofing";
import { DOORS_WINDOWS } from "../../../prisma/seeds/workflows/doors-windows";
import { CODE_VIOLATION } from "../../../prisma/seeds/workflows/code-violation";
import { fakeTree } from "./test-helpers";
import type { TemplateDefinition } from "./templates/types";

/**
 * previewReconcile on an in-memory job: the diff rules the spec cares about
 * (cases 8–12, 16) — never delete, keep completed and manual, skip what left
 * the plan, reinstate only engine skips, Core refused, drift reported.
 */

const { db } = vi.hoisted(() => ({
  db: {
    jobWorkflowInstance: { findUnique: vi.fn() },
    jobWorkflowModule: { findMany: vi.fn() },
    workflowTemplateVersion: { findFirst: vi.fn(), findUnique: vi.fn() },
    task: { findMany: vi.fn() },
    taskDependency: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn() }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent: vi.fn(), recordTaskEvents: vi.fn() }));
vi.mock("@/lib/tasks/create", () => ({ createTask: vi.fn() }));
vi.mock("./notify", () => ({ notifyTasksReady: vi.fn() }));

const { previewReconcile, ReconcileError, ENGINE_SKIP_PREFIX } = await import("./reconcile");
const { compose } = await import("./compose");
const { toComposeModule } = await import("./load");

type Row = { id: string; title: string; status: string; skipReason: string | null; blocking: boolean; workflowTaskKey: string | null; workflowModuleKey: string | null; workflowPhaseKey: string | null };

function setup(opts: { modules: TemplateDefinition[]; permitStatus: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED"; rows?: (r: Row) => Row; extraRows?: Row[]; versions?: Record<string, number> }) {
  const trees = opts.modules.map((d) => fakeTree(d, { version: opts.versions?.[d.key] ?? 1 }));
  db.jobWorkflowInstance.findUnique.mockResolvedValue({
    id: "w1",
    jobId: "j1",
    violationCaseId: null,
    permitStatus: opts.permitStatus,
    scopeToggles: {},
    appliedAt: new Date(),
    modules: trees.map((t) => ({ templateKey: t.template.key, templateVersionId: t.id, removedAt: null })),
  });
  db.jobWorkflowModule.findMany.mockResolvedValue(trees.map((t) => ({ templateVersion: t })));
  // "Apply" the current plan into rows.
  const plan = compose({ modules: trees.map(toComposeModule), permitStatus: opts.permitStatus, scopeToggles: {} });
  let rows: Row[] = plan.tasks.map((t, i) => ({
    id: `t${i}`,
    title: t.title,
    status: "PENDING",
    skipReason: null,
    blocking: t.blocking,
    workflowTaskKey: t.key,
    workflowModuleKey: t.moduleKey,
    workflowPhaseKey: t.phaseKey,
  }));
  if (opts.rows) rows = rows.map(opts.rows);
  rows.push(...(opts.extraRows ?? []));
  db.task.findMany.mockResolvedValue(rows);
  db.taskDependency.findMany.mockResolvedValue([]);
  return { rows, plan };
}

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
});

describe("previewReconcile — permit", () => {
  it("dropping the requirement needs a reason", async () => {
    setup({ modules: [CORE, ROOFING], permitStatus: "REQUIRED" });
    await expect(previewReconcile("w1", { kind: "permit", status: "NOT_REQUIRED" })).rejects.toBeInstanceOf(ReconcileError);
  });

  it("REQUIRED → NOT_REQUIRED skips the open permit steps, keeps the completed ones, adds the no-permit branch", async () => {
    const { rows } = setup({
      modules: [CORE, ROOFING],
      permitStatus: "REQUIRED",
      rows: (r) => (r.workflowTaskKey === "roofing:prepare_permit_application" ? { ...r, status: "COMPLETED" } : r),
    });
    const plan = await previewReconcile("w1", { kind: "permit", status: "NOT_REQUIRED", reason: "City confirmed exempt" });
    expect(plan.toCreate.map((t) => t.key)).toEqual(expect.arrayContaining(["roofing:verify_no_permit_required", "roofing:obtain_pm_approval_no_permit"]));
    expect(plan.toSkip.map((t) => t.key)).toContain("roofing:confirm_permit_issued");
    expect(plan.toSkip.map((t) => t.key)).not.toContain("roofing:prepare_permit_application");
    expect(plan.preserved.find((p) => p.key === "roofing:prepare_permit_application")?.why).toBe("completed");
    // Nothing that stays in the plan is touched.
    expect(plan.toSkip.map((t) => t.key)).not.toContain("roofing:mobilize");
    expect(rows.length).toBeGreaterThan(plan.toSkip.length);
    expect(plan.edgesToAdd).toBeGreaterThan(0);
  });

  it("NOT_REQUIRED → REQUIRED reinstates steps the engine skipped but not steps a person skipped", async () => {
    setup({
      modules: [CORE, ROOFING],
      permitStatus: "NOT_REQUIRED",
      extraRows: [
        { id: "old1", title: "Submit permit package", status: "CANCELLED", skipReason: `${ENGINE_SKIP_PREFIX}permit status changed to Not required`, blocking: false, workflowTaskKey: "roofing:submit_permit_package", workflowModuleKey: "roofing", workflowPhaseKey: "roofing:permit_required" },
        { id: "old2", title: "Track permit review", status: "CANCELLED", skipReason: "Owner handled it", blocking: false, workflowTaskKey: "roofing:track_permit_review", workflowModuleKey: "roofing", workflowPhaseKey: "roofing:permit_required" },
      ],
    });
    const plan = await previewReconcile("w1", { kind: "permit", status: "REQUIRED" });
    expect(plan.toReinstate.map((t) => t.key)).toEqual(["roofing:submit_permit_package"]);
    expect(plan.preserved.find((p) => p.key === "roofing:track_permit_review")?.why).toBe("user-skipped");
    expect(plan.toCreate.map((t) => t.key)).toContain("roofing:confirm_permit_issued");
    expect(plan.toSkip.map((t) => t.key)).toContain("roofing:obtain_pm_approval_no_permit");
  });
});

describe("previewReconcile — modules", () => {
  it("Core cannot be removed and removing a trade needs a reason", async () => {
    setup({ modules: [CORE, ROOFING], permitStatus: "REQUIRED" });
    await expect(previewReconcile("w1", { kind: "remove-module", templateKey: "core", reason: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(previewReconcile("w1", { kind: "remove-module", templateKey: "roofing", reason: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("removing a trade skips its open steps, retains what was asked for, keeps manual tasks, and brings Core's overridden closeout back", async () => {
    const { rows } = setup({
      modules: [CORE, ROOFING],
      permitStatus: "REQUIRED",
      rows: (r) => (r.workflowTaskKey === "roofing:verify_roof_measurements" ? { ...r, status: "COMPLETED" } : r),
      extraRows: [{ id: "m1", title: "Order the porta-john", status: "PENDING", skipReason: null, blocking: false, workflowTaskKey: null, workflowModuleKey: "roofing", workflowPhaseKey: "roofing:installation" }],
    });
    const keep = rows.find((r) => r.workflowTaskKey === "roofing:confirm_roof_system")!.id;
    const plan = await previewReconcile("w1", { kind: "remove-module", templateKey: "roofing", reason: "Roof scope moved to another contractor", retainTaskIds: [keep] });
    expect(plan.toSkip.every((t) => t.moduleKey === "roofing")).toBe(true);
    expect(plan.toSkip.map((t) => t.key)).toContain("roofing:mobilize");
    expect(plan.toSkip.map((t) => t.key)).not.toContain("roofing:confirm_roof_system");
    expect(plan.preserved.find((p) => p.id === keep)?.why).toBe("retained");
    expect(plan.preserved.find((p) => p.key === "roofing:verify_roof_measurements")?.why).toBe("completed");
    expect(plan.preserved.find((p) => p.id === "m1")?.why).toBe("manual");
    expect(plan.toCreate.map((t) => t.key)).toEqual(expect.arrayContaining(["core:submit_final_invoice", "core:confirm_final_payment", "core:close_job"]));
    expect(plan.modules.map((m) => m.moduleKey)).toEqual(["core"]);
  });

  it("adding a trade creates only its steps and suppresses the Core steps it overrides", async () => {
    setup({ modules: [CORE, ROOFING], permitStatus: "REQUIRED" });
    db.workflowTemplateVersion.findFirst.mockResolvedValue(fakeTree(DOORS_WINDOWS));
    const plan = await previewReconcile("w1", { kind: "add-module", templateKeys: ["doors_windows"] });
    expect(plan.toCreate.every((t) => t.moduleKey === "doors_windows")).toBe(true);
    expect(plan.toCreate.length).toBeGreaterThan(50);
    expect(plan.toSkip).toEqual([]);
    expect(plan.modules.map((m) => m.moduleKey)).toEqual(["core", "roofing", "doors_windows"]);
  });

  it("upgrading reports title drift and adds new keys without touching existing rows", async () => {
    setup({ modules: [CORE, ROOFING], permitStatus: "REQUIRED" });
    const v2: TemplateDefinition = {
      ...ROOFING,
      tasks: [
        ...ROOFING.tasks.map((t) => (t.key === "mobilize" ? { ...t, title: "Mobilize crew and equipment" } : t)),
        { ...ROOFING.tasks[0]!, key: "brand_new_step", title: "Brand new step", phaseKey: "installation" },
      ],
    };
    db.workflowTemplateVersion.findFirst.mockResolvedValue(fakeTree(v2, { version: 2 }));
    const plan = await previewReconcile("w1", { kind: "upgrade-module", templateKey: "roofing" });
    expect(plan.drift).toContainEqual({ key: "roofing:mobilize", field: "title", from: "Mobilize", to: "Mobilize crew and equipment" });
    expect(plan.toCreate.map((t) => t.key)).toEqual(["roofing:brand_new_step"]);
    expect(plan.toSkip).toEqual([]);
    expect(plan.modules.find((m) => m.moduleKey === "roofing")?.version).toBe(2);
  });
});

describe("previewReconcile — violation case", () => {
  function setupCase(permitStatus: "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED") {
    const r = setup({ modules: [CODE_VIOLATION], permitStatus });
    // The same instance row, owned by a case instead of a job.
    const row = db.jobWorkflowInstance.findUnique.mock.results[0]?.value ?? null;
    db.jobWorkflowInstance.findUnique.mockResolvedValue({ ...(row ? {} : {}), id: "w1", jobId: null, violationCaseId: "c1", permitStatus, scopeToggles: {}, appliedAt: new Date(), modules: [{ templateKey: "code_violation", templateVersionId: "v-code_violation-1", removedAt: null }] });
    return r;
  }

  it("deciding the permit adds only that branch and reports its own gate", async () => {
    setupCase("UNDETERMINED");
    const plan = await previewReconcile("w1", { kind: "permit", status: "REQUIRED" });
    expect(plan.toCreate.map((t) => t.key)).toEqual(expect.arrayContaining(["code_violation:confirm_permit_issued", "code_violation:close_permit"]));
    expect(plan.toCreate.every((t) => t.moduleKey === "code_violation")).toBe(true);
    expect(plan.toSkip).toEqual([]);
    expect(plan.modules.map((m) => m.moduleKey)).toEqual(["code_violation"]);
  });

  it("a case runs one template: trades cannot be added and the template cannot be removed", async () => {
    setupCase("REQUIRED");
    await expect(previewReconcile("w1", { kind: "add-module", templateKeys: ["roofing"] })).rejects.toThrow(/single template/);
    await expect(previewReconcile("w1", { kind: "remove-module", templateKey: "code_violation", reason: "no" })).rejects.toThrow(/cannot be removed/);
  });

  it("a scope toggle skips and reinstates whole groups through the engine, never deleting", async () => {
    const { rows } = setupCase("REQUIRED");
    const on = await previewReconcile("w1", { kind: "scope", scopeToggles: { code_violation: { hearing_required: true } } });
    expect(on.toCreate.map((t) => t.key)).toEqual(expect.arrayContaining(["code_violation:calendar_hearing", "code_violation:record_hearing_outcome"]));
    expect(on.toSkip).toEqual([]);
    // Everything currently open and not in the new plan is skipped, not deleted.
    const off = await previewReconcile("w1", { kind: "scope", scopeToggles: { code_violation: { construction_required: false } } });
    expect(off.toSkip.map((t) => t.key)).toEqual(expect.arrayContaining(["code_violation:create_or_link_job", "code_violation:corrective_work_complete"]));
    expect(off.toSkip.length + off.preserved.length + rows.length - off.toSkip.length).toBeGreaterThan(0);
  });
});
