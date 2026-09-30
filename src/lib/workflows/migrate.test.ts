import { describe, expect, it, vi } from "vitest";
import { CORE as CORE_V1 } from "../../../prisma/seeds/workflows/v1/core";
import { ROOFING as ROOFING_V1 } from "../../../prisma/seeds/workflows/v1/roofing";
import { DOORS_WINDOWS as DW_V1 } from "../../../prisma/seeds/workflows/v1/doors-windows";
import { CODE_VIOLATION as CV_V1 } from "../../../prisma/seeds/workflows/v1/code-violation";
import { CORE } from "../../../prisma/seeds/workflows/v2/core";
import { ROOFING } from "../../../prisma/seeds/workflows/v2/roofing";
import { DOORS_WINDOWS } from "../../../prisma/seeds/workflows/v2/doors-windows";
import { CODE_VIOLATION } from "../../../prisma/seeds/workflows/v2/code-violation";
import { SLIM_ABSORBS, SLIM_DROPPED, SLIM_PHASE_MAP, SLIM_TOGGLE_MAP } from "../../../prisma/seeds/workflows/v2/mapping";
import type { TemplateDefinition } from "./templates/types";
import type { ScopeToggleState } from "./keys";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn() }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent: vi.fn(), recordTaskEvents: vi.fn() }));
vi.mock("@/lib/tasks/create", () => ({ createTask: vi.fn() }));
vi.mock("./notify", () => ({ notifyTasksReady: vi.fn() }));

const { planMigration } = await import("./migrate");
const { compose } = await import("./compose");
type MigrationRow = import("./migrate").MigrationRow;
type ComposeModule = import("./compose").ComposeModule;

/**
 * planMigration is the whole decision about what happens to a job's steps
 * when it moves to the streamlined templates. Nothing is deleted, nothing a
 * person closed is touched, and the rest follows the mapping.
 */

const MAPPING = { absorbs: SLIM_ABSORBS, dropped: SLIM_DROPPED, toggles: SLIM_TOGGLE_MAP, phases: SLIM_PHASE_MAP };
const mod = (def: TemplateDefinition, version: number): ComposeModule => ({
  moduleKey: def.key,
  kind: def.kind,
  name: def.name,
  trade: def.trade,
  versionId: `${def.key}-v${version}`,
  version,
  definition: def,
});

type Permit = "UNDETERMINED" | "REQUIRED" | "NOT_REQUIRED";

/** The rows a job has the day its v1 workflow was applied. */
function applied(defs: TemplateDefinition[], permitStatus: Permit, scopeToggles: ScopeToggleState = {}): MigrationRow[] {
  const plan = compose({ modules: defs.map((d) => mod(d, 1)), permitStatus, scopeToggles });
  return plan.tasks.map((t) => ({
    id: `row:${t.key}`,
    key: t.key,
    title: t.title,
    status: "PENDING",
    skipReason: null,
    assignedUserId: null,
    dueAt: null,
    dueLocked: false,
    completedAt: null,
    completedByUserId: null,
    blockedReason: null,
    phaseKey: t.phaseKey,
    sortOrder: t.sortOrder,
    role: t.role,
    blocking: t.blocking,
    requiredEvidence: t.requiredEvidence,
    requiredEvidenceParam: t.requiredEvidenceParam,
    checklistLabels: t.checklist.map((c) => c.label),
    inspectionResult: null,
  }));
}

const done = (rows: MigrationRow[], keys: string[], at = "2026-09-10T15:00:00Z", by = "u-pm") => {
  for (const k of keys) {
    const r = rows.find((x) => x.key === k);
    if (!r) throw new Error(`no row ${k}`);
    Object.assign(r, { status: "COMPLETED", completedAt: new Date(at), completedByUserId: by });
  }
};
const row = (rows: MigrationRow[], key: string) => rows.find((r) => r.key === key)!;

const job = (rows: MigrationRow[], v1: TemplateDefinition[], slim: TemplateDefinition[], permitStatus: Permit, scopeToggles: ScopeToggleState = {}) =>
  planMigration({ rows, current: v1.map((d) => mod(d, 1)), target: slim.map((d) => mod(d, 2)), permitStatus, scopeToggles, mapping: MAPPING });

describe("planMigration — an untouched job", () => {
  const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
  const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");

  it("lands on the streamlined plan: 24 steps where there were 92", () => {
    expect(rows).toHaveLength(92);
    expect(plan.state).toBe("migrate");
    expect(plan.blockers).toEqual([]);
    expect(plan.plan.tasks).toHaveLength(24);
  });

  it("keeps the rows whose key lives on, refreshed; creates the rest", () => {
    expect(plan.refresh.map((r) => r.key).sort()).toEqual([
      "core:assign_project_manager",
      "core:confirm_production_start",
      "core:determine_permit_requirement",
      "core:review_contract",
      "core:verify_deposit",
    ]);
    const review = plan.refresh.find((r) => r.key === "core:review_contract")!;
    expect(review.refresh.title).toBe("Review contract, scope and job record");
    expect(review.refresh.definition.requiredEvidence).toBeNull();
    expect(review.refresh.definition.checklist).toHaveLength(5);
    expect(review.reinstate).toBe(false);
    expect(plan.create).toHaveLength(24 - 5);
    expect(plan.create).toContain("core:confirm_permit_issued");
    expect(plan.create).toContain("roofing:install_roof_system");
  });

  it("retires every other open step with the one recognisable reason, and completes nothing", () => {
    expect(plan.skip).toHaveLength(92 - 5);
    expect(new Set(plan.skip.map((s) => s.reason))).toEqual(new Set(["Workflow: replaced by the streamlined workflow"]));
    expect(plan.complete).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.unmapped).toEqual([]);
    expect(plan.kept).toEqual({ completed: 0, peopleSkipped: 0, alreadyRetired: 0, manual: 0 });
  });
});

describe("planMigration — work already done carries over", () => {
  it("a step that lives on stays done; a merged step is done only when everything it replaces was", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    done(rows, ["core:review_contract", "core:confirm_customer_property", "core:assign_project_manager", "core:determine_permit_requirement", "core:confirm_jurisdiction"]);
    done(rows, ["core:schedule_internal_kickoff", "core:complete_precon_review"]);
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");

    // Done rows are not refreshed, only filed under the streamlined phase and order.
    expect(plan.refresh.map((r) => r.key).sort()).toEqual(["core:confirm_production_start", "core:verify_deposit"]);
    expect(plan.rehome.map((r) => r.id)).toContain("row:core:determine_permit_requirement");
    expect(plan.refresh.map((r) => r.key)).not.toContain("core:review_contract");
    // Two of the eight preconstruction steps were done: the new step stays open and says so.
    expect(plan.complete.map((c) => c.key)).not.toContain("core:precon_plan");
    expect(plan.notes).toContainEqual({ key: "core:precon_plan", done: ["Schedule internal kickoff", "Complete preconstruction review"] });
    // Completed and open-but-retired rows of the earlier generation are counted, never re-opened.
    expect(plan.kept.completed).toBe(4);
    expect(plan.skip.some((s) => s.key === "core:review_contract")).toBe(false);
  });

  it("a new step is born done with the date and the person of the last thing it replaces", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    const scope = SLIM_ABSORBS["roofing:confirm_roof_scope"]!.filter((k) => rows.some((r) => r.key === k));
    done(rows, scope.slice(0, -1), "2026-09-08T15:00:00Z", "u-est");
    done(rows, scope.slice(-1), "2026-09-12T15:00:00Z", "u-sup");
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    const c = plan.complete.find((x) => x.key === "roofing:confirm_roof_scope")!;
    expect(c.at).toEqual(new Date("2026-09-12T15:00:00Z"));
    expect(c.byUserId).toBe("u-sup");
    expect(c.from).toHaveLength(scope.length);
  });

  it("a step a person skipped counts as settled; one the engine skipped never existed", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    const parts = SLIM_ABSORBS["roofing:fall_protection_plan"]!;
    done(rows, [parts[0]!]);
    Object.assign(row(rows, parts[1]!), { status: "CANCELLED", skipReason: "Covered by the GC's site plan" });
    expect(job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED").complete.map((c) => c.key)).toContain("roofing:fall_protection_plan");

    // All skipped by people, none done: nothing was completed, so the step stays open.
    const none = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    for (const k of parts) Object.assign(row(none, k), { status: "CANCELLED", skipReason: "Not needed" });
    const p2 = job(none, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    expect(p2.complete.map((c) => c.key)).not.toContain("roofing:fall_protection_plan");
    expect(p2.kept.peopleSkipped).toBe(2);

    // The engine skipped one of two (a scope that was off): the other alone decides.
    const eng = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    done(eng, [parts[0]!]);
    Object.assign(row(eng, parts[1]!), { status: "CANCELLED", skipReason: "Workflow: scope changed — this step is no longer included" });
    const p3 = job(eng, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    expect(p3.complete.map((c) => c.key)).toContain("roofing:fall_protection_plan");
    expect(p3.kept.alreadyRetired).toBe(1);
  });

  it("with two trades, Core's single permit application is done only when both trades' were", () => {
    const rows = applied([CORE_V1, ROOFING_V1, DW_V1], "REQUIRED");
    const roofing = SLIM_ABSORBS["core:submit_permit_application"]!.filter((k) => k.startsWith("roofing:"));
    const dw = SLIM_ABSORBS["core:submit_permit_application"]!.filter((k) => k.startsWith("doors_windows:"));
    done(rows, roofing);
    const half = job(rows, [CORE_V1, ROOFING_V1, DW_V1], [CORE, ROOFING, DOORS_WINDOWS], "REQUIRED");
    expect(half.plan.tasks).toHaveLength(32);
    expect(half.complete.map((c) => c.key)).not.toContain("core:submit_permit_application");
    expect(half.notes.find((n) => n.key === "core:submit_permit_application")!.done).toHaveLength(3);
    done(rows, dw);
    expect(job(rows, [CORE_V1, ROOFING_V1, DW_V1], [CORE, ROOFING, DOORS_WINDOWS], "REQUIRED").complete.map((c) => c.key)).toContain("core:submit_permit_application");
  });
});

describe("planMigration — work in flight", () => {
  it("an open new step inherits the owner, the status and a hand-set date from the steps it replaces", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    Object.assign(row(rows, "roofing:issue_purchase_order"), { status: "IN_PROGRESS", assignedUserId: "u-pur", dueAt: new Date("2026-10-20T21:00:00Z"), dueLocked: true });
    Object.assign(row(rows, "roofing:confirm_weather_window"), { status: "BLOCKED", blockedReason: "Waiting on the storm to pass", assignedUserId: "u-sup" });
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    expect(plan.carry).toContainEqual({ key: "roofing:order_roofing_materials", assigneeId: "u-pur", status: "IN_PROGRESS", blockedReason: null, dueAt: new Date("2026-10-20T21:00:00Z") });
    expect(plan.carry).toContainEqual({ key: "roofing:roofing_ready_to_start", assigneeId: "u-sup", status: "BLOCKED", blockedReason: "Waiting on the storm to pass", dueAt: null });
    // The in-flight rows themselves are still retired: the new step is the work now.
    expect(plan.skip.map((s) => s.key)).toContain("roofing:issue_purchase_order");
  });

  it("two different owners means nobody is assumed", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    row(rows, "roofing:issue_purchase_order").assignedUserId = "u-a";
    row(rows, "roofing:schedule_material_delivery").assignedUserId = "u-b";
    expect(job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED").carry.find((c) => c.key === "roofing:order_roofing_materials")).toBeUndefined();
  });

  it("a failed inspection or an open correction stops the migration for a person to settle", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    Object.assign(row(rows, "roofing:obtain_deck_inspection"), { status: "BLOCKED", blockedReason: "Failed inspection", inspectionResult: "FAIL" });
    rows.push({ ...row(rows, "roofing:mobilize"), id: "corr1", key: "roofing:obtain_deck_inspection:correction:1", title: "Correct failed inspection items — Obtain deck inspection", status: "PENDING" });
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    expect(plan.blockers).toHaveLength(2);
    expect(plan.blockers[0]).toMatch(/failed inspection|correction/);

    // A closed correction is history and blocks nothing.
    const closed = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    closed.push({ ...row(closed, "roofing:mobilize"), id: "corr1", key: "roofing:obtain_deck_inspection:correction:1", status: "COMPLETED" });
    expect(job(closed, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED").blockers).toEqual([]);
  });

  it("a step added in the editor is retired like the rest and reported", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    rows.push({ ...row(rows, "roofing:mobilize"), id: "ridge", key: "roofing:install_ridge_vent", title: "Install ridge vent" });
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    expect(plan.unmapped).toEqual(["roofing:install_ridge_vent"]);
    expect(plan.skip.map((s) => s.key)).toContain("roofing:install_ridge_vent");
  });

  it("a manual task moves under the streamlined phase its old phase became", () => {
    const rows = applied([CORE_V1, ROOFING_V1], "REQUIRED");
    const manual = { ...row(rows, "roofing:mobilize"), id: "m1", key: null, title: "Call the HOA" };
    rows.push({ ...manual, phaseKey: "core:preconstruction" }, { ...manual, id: "m2", phaseKey: "roofing:permit_required" }, { ...manual, id: "m3", phaseKey: "roofing:installation" });
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "REQUIRED");
    expect(plan.rehome.filter((r) => r.id.startsWith("m"))).toEqual([
      { id: "m1", phaseKey: "core:job_setup", sortOrder: null },
      { id: "m2", phaseKey: "core:permit_required", sortOrder: null },
    ]);
    expect(plan.kept.manual).toBe(3);
    expect(plan.skip.some((s) => s.id.startsWith("m"))).toBe(false);
  });
});

describe("planMigration — scope options and the permit branch", () => {
  it("maps the earlier scope options onto the streamlined ones", () => {
    const toggles = { roofing: { tpo: true, metal: true, tear_off: false }, doors_windows: { interior_restoration: false, exterior_restoration: true, interior_doors: true } };
    const rows = applied([CORE_V1, ROOFING_V1, DW_V1], "REQUIRED", toggles);
    const plan = job(rows, [CORE_V1, ROOFING_V1, DW_V1], [CORE, ROOFING, DOORS_WINDOWS], "REQUIRED", toggles);
    expect(plan.scopeToggles.roofing).toEqual({ tear_off: false, deck_repairs: true, low_slope: true, crane: false, mfr_warranty: true, occupied: true });
    expect(plan.scopeToggles.doors_windows).toMatchObject({ restoration: true, windows: true, impact: true, engineering: false });
    expect(plan.droppedToggles.sort()).toEqual(["doors_windows.interior_doors", "roofing.metal"]);
  });

  it("leaves the permit branch where it is: undetermined, required or not required", () => {
    for (const [status, n] of [["UNDETERMINED", 18], ["REQUIRED", 24], ["NOT_REQUIRED", 20]] as const) {
      const rows = applied([CORE_V1, ROOFING_V1], status);
      const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], status);
      expect(plan.plan.tasks, status).toHaveLength(n);
      expect(plan.plan.warnings, status).toEqual([]);
    }
    // Not required: the trade's verified no-permit steps make Core's single pair done.
    const rows = applied([CORE_V1, ROOFING_V1], "NOT_REQUIRED");
    done(rows, ["roofing:verify_no_permit_required", "roofing:record_no_permit_confirmation", "roofing:upload_no_permit_support", "roofing:obtain_pm_approval_no_permit"]);
    const plan = job(rows, [CORE_V1, ROOFING_V1], [CORE, ROOFING], "NOT_REQUIRED");
    expect(plan.complete.map((c) => c.key).sort()).toEqual(["core:obtain_pm_approval_no_permit", "core:verify_no_permit_required"]);
  });
});

describe("planMigration — a violation case", () => {
  it("keeps every gate row, refreshed, and hands site steps to the case manager", () => {
    const rows = applied([CV_V1], "UNDETERMINED");
    done(rows, ["code_violation:assign_case_manager", "code_violation:upload_review_notice"]);
    const plan = planMigration({ rows, current: [mod(CV_V1, 1)], target: [mod(CODE_VIOLATION, 2)], permitStatus: "UNDETERMINED", scopeToggles: {}, mapping: MAPPING });
    expect(rows).toHaveLength(43);
    expect(plan.plan.tasks).toHaveLength(17);
    expect(plan.blockers).toEqual([]);
    const reinspection = plan.refresh.find((r) => r.key === "code_violation:agency_reinspection")!;
    expect(reinspection.assignRole).toBe("CASE_MANAGER");
    expect(reinspection.refresh.definition.requiredEvidence).toBe("INSPECTION_RESULT");
    expect(plan.refresh.map((r) => r.key)).toContain("code_violation:close_case");
    expect(plan.create).toEqual(expect.arrayContaining(["code_violation:review_notice", "code_violation:inspect_site"]));
    // One of the four intake steps the new "review the notice" replaces was done.
    expect(plan.notes).toContainEqual({ key: "code_violation:review_notice", done: ["Upload and review the violation notice"] });
    expect(plan.unmapped).toEqual([]);
  });
});

describe("planMigration — running it again", () => {
  it("over an instance already on the target changes nothing", () => {
    // The state a migrated job is in: streamlined rows, plus closed rows of the earlier generation.
    const slim = compose({ modules: [mod(CORE, 2), mod(ROOFING, 2)], permitStatus: "REQUIRED", scopeToggles: {} });
    const rows: MigrationRow[] = slim.tasks.map((t) => ({
      id: `row:${t.key}`, key: t.key, title: t.title, status: "PENDING", skipReason: null, assignedUserId: null, dueAt: null, dueLocked: false,
      completedAt: null, completedByUserId: null, blockedReason: null, phaseKey: t.phaseKey, sortOrder: t.sortOrder, role: t.role, blocking: t.blocking,
      requiredEvidence: t.requiredEvidence, requiredEvidenceParam: t.requiredEvidenceParam, checklistLabels: t.checklist.map((c) => c.label), inspectionResult: null,
    }));
    const legacy = applied([CORE_V1, ROOFING_V1], "REQUIRED").filter((r) => !slim.tasks.some((t) => t.key === r.key));
    for (const r of legacy) Object.assign(r, { status: "CANCELLED", skipReason: "Workflow: replaced by the streamlined workflow" });
    done(legacy, ["core:confirm_customer_property"]);
    const plan = planMigration({ rows: [...rows, ...legacy], current: [mod(CORE, 2), mod(ROOFING, 2)], target: [mod(CORE, 2), mod(ROOFING, 2)], permitStatus: "REQUIRED", scopeToggles: {}, mapping: MAPPING });
    expect(plan.state).toBe("resume");
    expect([plan.create, plan.refresh, plan.rehome, plan.complete, plan.carry, plan.skip]).toEqual([[], [], [], [], [], []]);
    expect(plan.kept.completed).toBe(1);
  });

  it("a job applied on the streamlined templates, with a trade added later, is left alone", () => {
    // Core + Roofing were applied first; adding Doors & Windows renumbers the plan but not the rows.
    const first = compose({ modules: [mod(CORE, 2), mod(ROOFING, 2)], permitStatus: "REQUIRED", scopeToggles: {} });
    const both = compose({ modules: [mod(CORE, 2), mod(ROOFING, 2), mod(DOORS_WINDOWS, 2)], permitStatus: "REQUIRED", scopeToggles: {} });
    const orderWhenCreated = new Map(first.tasks.map((t) => [t.key, t.sortOrder]));
    const rows: MigrationRow[] = both.tasks.map((t) => ({
      id: `row:${t.key}`, key: t.key, title: t.title, status: t.key === "core:review_contract" ? "COMPLETED" : "PENDING", skipReason: null, assignedUserId: null, dueAt: null, dueLocked: false,
      completedAt: null, completedByUserId: null, blockedReason: null, phaseKey: t.phaseKey, sortOrder: orderWhenCreated.get(t.key) ?? t.sortOrder, role: t.role, blocking: t.blocking,
      requiredEvidence: t.requiredEvidence, requiredEvidenceParam: t.requiredEvidenceParam, checklistLabels: t.checklist.map((c) => c.label), inspectionResult: null,
    }));
    expect(rows.some((r) => r.sortOrder !== both.tasks.find((t) => t.key === r.key)!.sortOrder)).toBe(true);
    const slim = [mod(CORE, 2), mod(ROOFING, 2), mod(DOORS_WINDOWS, 2)];
    const plan = planMigration({ rows, current: slim, target: slim, permitStatus: "REQUIRED", scopeToggles: {}, mapping: MAPPING });
    expect([plan.create, plan.refresh, plan.rehome, plan.complete, plan.carry, plan.skip]).toEqual([[], [], [], [], [], []]);
  });

  it("refuses a target that is not the same set of templates", () => {
    expect(() => planMigration({ rows: [], current: [mod(CORE_V1, 1), mod(ROOFING_V1, 1)], target: [mod(CORE, 2)], permitStatus: "REQUIRED", scopeToggles: {}, mapping: MAPPING })).toThrow(/same templates/);
  });
});
