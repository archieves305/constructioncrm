import { beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "./compose";
import { CORE } from "../../../prisma/seeds/workflows/core";
import { ROOFING } from "../../../prisma/seeds/workflows/roofing";

/**
 * materializePlan against an in-memory "database": proves the two rules the
 * whole feature leans on — a second apply creates nothing, and a re-plan
 * (permit decided) adds only the missing steps and re-points edges without
 * touching existing rows.
 */

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { exception: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }));
vi.mock("./notify", () => ({ notifyTasksReady: vi.fn() }));
vi.mock("@/lib/tasks/create", () => ({ createTask }));

const { materializePlan } = await import("./apply");

type Row = { id: string; workflowTaskKey: string | null; activatedAt: Date | null; assignedUserId: string | null };
type Edge = { id: string; taskId: string; dependsOnTaskId: string; kind: string; source: string };

function fakeTx(rows: Row[], edges: Edge[]) {
  let n = rows.length;
  let e = edges.length;
  createTask.mockImplementation(async (input: { workflow: { taskKey: string }; activatedAt: Date | null; assignedUserId: string | null }) => {
    const row = { id: `t${++n}`, workflowTaskKey: input.workflow.taskKey, activatedAt: input.activatedAt, assignedUserId: input.assignedUserId };
    rows.push(row);
    return row;
  });
  return {
    task: {
      findMany: vi.fn(async () => rows.map((r) => ({ id: r.id, workflowTaskKey: r.workflowTaskKey }))),
    },
    taskDependency: {
      findMany: vi.fn(async () => edges.map((x) => ({ ...x }))),
      createMany: vi.fn(async ({ data }: { data: Omit<Edge, "id">[] }) => {
        for (const d of data) edges.push({ id: `e${++e}`, ...d });
        return { count: data.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        const drop = new Set(where.id.in);
        for (let i = edges.length - 1; i >= 0; i--) if (drop.has(edges[i]!.id)) edges.splice(i, 1);
        return { count: drop.size };
      }),
    },
  } as unknown as import("@/generated/prisma/client").Prisma.TransactionClient;
}

const mod = (def: typeof CORE) => ({ moduleKey: def.key, kind: def.kind, name: def.name, trade: def.trade, versionId: `v-${def.key}`, version: 1, definition: def });
const roleCtx = { team: {}, projectManagerId: "u-pm", salesRepId: null, defaults: {} };
const now = new Date(2026, 9, 2, 10);
const ctx = { jobCreatedAt: now, appliedAt: now, targetStartDate: null };
const args = (tx: ReturnType<typeof fakeTx>, plan: ReturnType<typeof compose>) => ({ instanceId: "w1", jobId: "j1", plan, roleCtx, ctx, actorUserId: "u-me", now });

// Braces matter: a hook that RETURNS the mock registers it as a cleanup hook.
beforeEach(() => {
  createTask.mockReset();
});

describe("materializePlan", () => {
  it("creates every planned step once, wires the edges, and a second pass creates nothing", async () => {
    const rows: Row[] = [];
    const edges: Edge[] = [];
    const tx = fakeTx(rows, edges);
    const plan = compose({ modules: [mod(CORE), mod(ROOFING)], permitStatus: "UNDETERMINED", scopeToggles: {} });

    const first = await materializePlan(tx, args(tx, plan));
    expect(first.created).toHaveLength(plan.tasks.length);
    expect(first.edgesAdded).toBe(plan.edges.length);
    expect(edges).toHaveLength(plan.edges.length);
    // Every step went through createTask with the workflow block and the key as sourceKey.
    const call = createTask.mock.calls[0]![0] as { sourceKey: string; source: string; workflow: { taskKey: string; instanceId: string } };
    expect(call.source).toBe("workflow");
    expect(call.sourceKey).toBe(`wf:w1:${call.workflow.taskKey}`);
    expect(call.workflow.instanceId).toBe("w1");
    // Only dependency-free steps start active; PM steps got the job's PM.
    const active = rows.filter((r) => r.activatedAt);
    expect(active.map((r) => r.workflowTaskKey)).toContain("core:review_contract");
    expect(active.map((r) => r.workflowTaskKey)).not.toContain("core:determine_permit_requirement");
    expect(rows.find((r) => r.workflowTaskKey === "core:review_contract")!.assignedUserId).toBe("u-pm");

    createTask.mockClear();
    const again = await materializePlan(tx, args(tx, plan));
    expect(again.created).toEqual([]);
    expect(again.edgesAdded).toBe(0);
    expect(again.edgesRemoved).toBe(0);
    expect(createTask).not.toHaveBeenCalled();
    expect(rows).toHaveLength(plan.tasks.length);
  });

  it("deciding the permit adds only the branch's steps and re-points the gate edges", async () => {
    const rows: Row[] = [];
    const edges: Edge[] = [];
    const tx = fakeTx(rows, edges);
    const undetermined = compose({ modules: [mod(CORE), mod(ROOFING)], permitStatus: "UNDETERMINED", scopeToggles: {} });
    await materializePlan(tx, args(tx, undetermined));
    const before = rows.length;

    const required = compose({ modules: [mod(CORE), mod(ROOFING)], permitStatus: "REQUIRED", scopeToggles: {} });
    const r = await materializePlan(tx, args(tx, required));
    // Exactly the steps the REQUIRED plan has that the UNDETERMINED plan did not
    // (Core's own final inspection is overridden by Roofing's, so it never appears).
    const had = new Set(undetermined.tasks.map((t) => t.key));
    const expected = required.tasks.filter((t) => !had.has(t.key)).map((t) => t.key);
    expect(expected).toContain("roofing:confirm_permit_issued");
    expect(expected).not.toContain("core:obtain_final_inspection");
    expect(r.created).toHaveLength(expected.length);
    expect(rows).toHaveLength(before + r.created.length);
    // Mobilize used to wait on the determination gate; now it waits on the permit gate.
    const idOf = (k: string) => rows.find((x) => x.workflowTaskKey === k)!.id;
    const mobilizeDeps = edges.filter((x) => x.taskId === idOf("roofing:mobilize")).map((x) => x.dependsOnTaskId);
    expect(mobilizeDeps).toContain(idOf("roofing:confirm_permit_issued"));
    expect(r.edgesRemoved).toBeGreaterThan(0);
    // Nothing that existed was recreated: the no-permit branch was never made.
    expect(rows.some((x) => x.workflowTaskKey === "roofing:obtain_pm_approval_no_permit")).toBe(false);
  });
});
