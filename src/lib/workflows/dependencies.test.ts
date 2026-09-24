import { describe, expect, it } from "vitest";
import { criticalPathBusinessDays, DependencyCycleError, findCycle, isReady, topoSort, type DepEdge } from "./dependencies";

const B = "BLOCKING" as const;
const D = "DATE_ONLY" as const;

describe("findCycle / topoSort", () => {
  it("returns null for a DAG and sorts predecessors first, stably", () => {
    const edges: DepEdge<string>[] = [
      { task: "c", dependsOn: "a", kind: B },
      { task: "c", dependsOn: "b", kind: B },
      { task: "d", dependsOn: "c", kind: D },
    ];
    expect(findCycle(["a", "b", "c", "d"], edges)).toBeNull();
    expect(topoSort(["b", "a", "c", "d"], edges)).toEqual(["b", "a", "c", "d"]);
  });

  it("finds a cycle and reports the closed path", () => {
    const edges: DepEdge<string>[] = [
      { task: "b", dependsOn: "a", kind: B },
      { task: "c", dependsOn: "b", kind: B },
      { task: "a", dependsOn: "c", kind: D },
    ];
    expect(findCycle(["a", "b", "c"], edges)).toEqual(["a", "b", "c", "a"]);
    expect(() => topoSort(["a", "b", "c"], edges)).toThrow(DependencyCycleError);
  });
});

describe("isReady", () => {
  it("needs every BLOCKING predecessor done or skipped; DATE_ONLY never holds", () => {
    expect(isReady([])).toBe(true);
    expect(isReady([{ kind: B, status: "COMPLETED" }, { kind: B, status: "CANCELLED" }])).toBe(true);
    expect(isReady([{ kind: B, status: "IN_PROGRESS" }])).toBe(false);
    expect(isReady([{ kind: D, status: "PENDING" }])).toBe(true);
  });
});

describe("criticalPathBusinessDays", () => {
  it("sums the longest blocking chain only", () => {
    const tasks = [
      { key: "a", days: 2 },
      { key: "b", days: 5 },
      { key: "c", days: 1 },
      { key: "d", days: 3 },
    ];
    const edges: DepEdge<string>[] = [
      { task: "c", dependsOn: "a", kind: B },
      { task: "c", dependsOn: "b", kind: B },
      { task: "d", dependsOn: "c", kind: D },
    ];
    // a→c = 3, b→c = 6; d is date-only so it does not extend the chain beyond its own 3.
    expect(criticalPathBusinessDays(tasks, edges)).toBe(6);
  });
});
