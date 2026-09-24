import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { summarizeInstance } = await import("./summary");
import type { SummaryInstance, SummaryPhase, SummaryTask } from "./summary";

const now = new Date("2026-09-24T12:00:00Z");
const past = new Date("2026-09-20T17:00:00Z");
const future = new Date("2026-09-30T17:00:00Z");

const instance: SummaryInstance = {
  id: "i1",
  jobId: "j1",
  status: "ACTIVE",
  permitStatus: "REQUIRED",
  appliedAt: new Date("2026-09-01T00:00:00Z"),
  modules: [
    { key: "core", name: "Core Construction", kind: "CORE", trade: null, index: 0 },
    { key: "roofing", name: "Roofing", kind: "TRADE", trade: "Roofing", index: 1 },
  ],
};

const phases = new Map<string, SummaryPhase>([
  ["core:job_setup", { key: "core:job_setup", name: "Job Setup", band: 100, sortOrder: 0 }],
  ["roofing:permitting", { key: "roofing:permitting", name: "Permitting", band: 400, sortOrder: 0 }],
  ["core:production", { key: "core:production", name: "Production", band: 700, sortOrder: 0 }],
]);

function task(over: Partial<SummaryTask>): SummaryTask {
  return {
    status: "PENDING",
    activatedAt: now,
    dueAt: null,
    assignedUserId: "u1",
    workflowPhaseKey: "core:job_setup",
    workflowTaskKey: "core:x",
    inspectionResult: null,
    ...over,
  };
}

describe("summarizeInstance", () => {
  it("counts ready, blocked, failed, overdue and unassigned on active steps only", () => {
    const s = summarizeInstance(
      instance,
      [
        task({ status: "PENDING", dueAt: past }), // ready + overdue
        task({ status: "PENDING", assignedUserId: null }), // ready + unassigned
        task({ status: "BLOCKED", inspectionResult: "FAIL", dueAt: past, workflowPhaseKey: "roofing:permitting" }),
        task({ status: "PENDING", activatedAt: null, dueAt: past, assignedUserId: null }), // not active: nothing counts
        task({ status: "IN_PROGRESS", dueAt: future }),
        task({ status: "PENDING", workflowTaskKey: null, dueAt: past, assignedUserId: null }), // manual: not a step
      ],
      { total: 10, done: 3, skipped: 1 },
      phases,
      now,
    );
    expect(s).toMatchObject({
      ready: 2,
      blocked: 1,
      failedInspections: 1,
      overdue: 2,
      unassigned: 1,
      total: 10,
      done: 3,
      skipped: 1,
      open: 6,
      percentComplete: 33,
      trades: [{ key: "roofing", name: "Roofing", trade: "Roofing" }],
    });
  });

  it("the current phase is the lowest band with active work, then the lowest waiting band", () => {
    const active = summarizeInstance(
      instance,
      [
        task({ workflowPhaseKey: "core:production" }),
        task({ workflowPhaseKey: "roofing:permitting" }),
        task({ workflowPhaseKey: "core:job_setup", activatedAt: null }),
      ],
      { total: 3, done: 0, skipped: 0 },
      phases,
      now,
    );
    expect(active.currentPhase).toEqual({ key: "roofing:permitting", name: "Permitting", moduleKey: "roofing", band: 400 });

    const waiting = summarizeInstance(
      instance,
      [task({ workflowPhaseKey: "core:production", activatedAt: null }), task({ workflowPhaseKey: "roofing:permitting", activatedAt: null })],
      { total: 2, done: 0, skipped: 0 },
      phases,
      now,
    );
    expect(waiting.currentPhase?.key).toBe("roofing:permitting");
  });

  it("nothing open means no current phase and 100%", () => {
    const s = summarizeInstance(instance, [], { total: 4, done: 3, skipped: 1 }, phases, now);
    expect(s.currentPhase).toBeNull();
    expect(s.percentComplete).toBe(100);
    expect(s.open).toBe(0);
  });

  it("an unknown phase key still reads (removed module)", () => {
    const s = summarizeInstance(instance, [task({ workflowPhaseKey: "siding:install" })], { total: 1, done: 0, skipped: 0 }, phases, now);
    expect(s.currentPhase).toEqual({ key: "siding:install", name: "install", moduleKey: "siding", band: 9999 });
  });
});
