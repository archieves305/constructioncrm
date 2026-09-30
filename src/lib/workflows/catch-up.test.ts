import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tasks/update", () => ({ updateTask: vi.fn(), TaskUpdateError: class extends Error {} }));
vi.mock("@/lib/tasks/events", () => ({ recordTaskEvent: vi.fn(), recordTaskEvents: vi.fn() }));
vi.mock("./notify", () => ({ notifyTasksReady: vi.fn() }));

const { planCatchUp } = await import("./catch-up");
type CatchUpRow = import("./catch-up").CatchUpRow;
type CatchUpEdge = import("./catch-up").CatchUpEdge;

const PHASE = "core:closeout";
let n = 0;
const row = (id: string, extra: Partial<CatchUpRow> = {}): CatchUpRow => ({
  id,
  key: `core:${id}`,
  title: id,
  status: "PENDING",
  phaseKey: PHASE,
  blocking: false,
  requiredEvidence: null,
  sortOrder: (n += 10),
  ...extra,
});
const dep = (taskId: string, dependsOnTaskId: string): CatchUpEdge => ({ taskId, dependsOnTaskId, kind: "BLOCKING" });
const states = (steps: ReturnType<typeof planCatchUp>) => Object.fromEntries(steps.map((s) => [s.id, s.state]));

describe("planCatchUp", () => {
  it("takes the open steps of one phase, in dependency order", () => {
    const rows = [row("punch"), row("invoice"), row("done", { status: "COMPLETED" }), row("other", { phaseKey: "core:job_setup" }), row("manual", { key: null })];
    const steps = planCatchUp(rows, [dep("punch", "invoice")], PHASE);
    // Invoice comes first because the punch list waits on it, whatever the display order.
    expect(steps.map((s) => s.id)).toEqual(["invoice", "punch"]);
    expect(states(steps)).toEqual({ invoice: "ok", punch: "ok" });
  });

  it("offers a blocking gate unticked, and holds what waits on it until it is ticked", () => {
    const rows = [row("lien", { blocking: true }), row("close")];
    const edges = [dep("close", "lien")];
    const first = planCatchUp(rows, edges, PHASE);
    expect(first.find((s) => s.id === "lien")).toMatchObject({ selected: false, state: "unselected" });
    expect(first.find((s) => s.id === "close")).toMatchObject({ state: "held", reason: "Waits on: lien" });
    const ticked = planCatchUp(rows, edges, PHASE, new Set(["lien", "close"]));
    expect(states(ticked)).toEqual({ lien: "ok", close: "ok" });
  });

  it("holds a step whose blocking predecessor lies outside the phase and is still open", () => {
    const rows = [row("work", { phaseKey: "core:production" }), row("punch")];
    expect(planCatchUp(rows, [dep("punch", "work")], PHASE)[0]).toMatchObject({ id: "punch", state: "held", reason: "Waits on: work" });
    // Done or skipped upstream is no obstacle; a date-only edge never is.
    rows[0]!.status = "CANCELLED";
    expect(planCatchUp(rows, [dep("punch", "work")], PHASE)[0]!.state).toBe("ok");
    rows[0]!.status = "PENDING";
    expect(planCatchUp(rows, [{ taskId: "punch", dependsOnTaskId: "work", kind: "DATE_ONLY" }], PHASE)[0]!.state).toBe("ok");
  });

  it("never catches up an inspection, a correction or Close case", () => {
    const rows = [
      row("final", { requiredEvidence: "INSPECTION_RESULT", blocking: true }),
      row("fix", { key: "core:final:correction:1" }),
      row("closing", { key: "code_violation:close_case", blocking: true }),
      row("payment", { requiredEvidence: "PAYMENT_STATUS", blocking: true }),
    ];
    const steps = planCatchUp(rows, [], PHASE, new Set(["final", "fix", "closing", "payment"]));
    expect(steps.map((s) => s.id)).toEqual(["final", "closing", "payment"]);
    expect(steps.find((s) => s.id === "final")).toMatchObject({ state: "held", reason: "Record the inspection result on the step" });
    expect(steps.find((s) => s.id === "closing")!.state).toBe("held");
    // A record gate is planned; whether the record exists is the server check's to say.
    expect(steps.find((s) => s.id === "payment")).toMatchObject({ state: "ok", gate: "PAYMENT_STATUS" });
  });

  it("a chain falls back step by step when its head is left out", () => {
    const rows = [row("a"), row("b"), row("c")];
    const edges = [dep("b", "a"), dep("c", "b")];
    expect(states(planCatchUp(rows, edges, PHASE, new Set(["b", "c"])))).toEqual({ a: "unselected", b: "held", c: "held" });
    expect(states(planCatchUp(rows, edges, PHASE, new Set(["a", "b", "c"])))).toEqual({ a: "ok", b: "ok", c: "ok" });
  });

  it("an empty phase plans nothing", () => {
    expect(planCatchUp([row("x", { status: "COMPLETED" })], [], PHASE)).toEqual([]);
  });
});
