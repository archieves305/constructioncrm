import type { TaskDependencyKind, TaskStatus } from "@/generated/prisma/client";

/**
 * Pure graph helpers over task dependencies. Generic on the node key so the
 * same code serves template keys at define time, full keys at compose time
 * and task ids at activation time.
 */

export type DepEdge<K> = {
  /** The task that waits. */
  task: K;
  /** The task it waits on. */
  dependsOn: K;
  kind: TaskDependencyKind;
};

export class DependencyCycleError<K = string> extends Error {
  constructor(public readonly path: K[]) {
    super(`Dependency cycle: ${path.map(String).join(" → ")}`);
    this.name = "DependencyCycleError";
  }
}

/**
 * Find one cycle and return it as a path that starts and ends on the same
 * node (["a", "b", "a"]), or null when the graph is acyclic. Considers every
 * edge kind: a DATE_ONLY loop would still make scheduling circular.
 */
export function findCycle<K>(nodes: Iterable<K>, edges: DepEdge<K>[]): K[] | null {
  const out = new Map<K, K[]>(); // predecessor → dependents
  for (const n of nodes) out.set(n, []);
  for (const e of edges) {
    if (!out.has(e.dependsOn)) out.set(e.dependsOn, []);
    if (!out.has(e.task)) out.set(e.task, []);
    out.get(e.dependsOn)!.push(e.task);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<K, number>();
  const stack: K[] = [];

  const visit = (n: K): K[] | null => {
    colour.set(n, GREY);
    stack.push(n);
    for (const m of out.get(n) ?? []) {
      const c = colour.get(m) ?? WHITE;
      if (c === GREY) {
        const start = stack.indexOf(m);
        return [...stack.slice(start), m];
      }
      if (c === WHITE) {
        const found = visit(m);
        if (found) return found;
      }
    }
    stack.pop();
    colour.set(n, BLACK);
    return null;
  };

  for (const n of out.keys()) {
    if ((colour.get(n) ?? WHITE) === WHITE) {
      const found = visit(n);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Kahn's algorithm. Stable: among ready nodes, input order is preserved, so
 * the result respects the template's own ordering wherever the graph allows.
 */
export function topoSort<K>(nodes: K[], edges: DepEdge<K>[]): K[] {
  const cycle = findCycle(nodes, edges);
  if (cycle) throw new DependencyCycleError(cycle);

  const indeg = new Map<K, number>(nodes.map((n) => [n, 0]));
  const out = new Map<K, K[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    if (!indeg.has(e.task) || !indeg.has(e.dependsOn)) continue;
    indeg.set(e.task, (indeg.get(e.task) ?? 0) + 1);
    out.get(e.dependsOn)!.push(e.task);
  }
  const result: K[] = [];
  const position = new Map(nodes.map((n, i) => [n, i]));
  const ready = nodes.filter((n) => indeg.get(n) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => position.get(a)! - position.get(b)!);
    const n = ready.shift()!;
    result.push(n);
    for (const m of out.get(n) ?? []) {
      const d = indeg.get(m)! - 1;
      indeg.set(m, d);
      if (d === 0) ready.push(m);
    }
  }
  return result;
}

/** A dependency is satisfied when the predecessor is done or was skipped. */
export function isSatisfied(status: TaskStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/**
 * Ready = every BLOCKING predecessor is satisfied. DATE_ONLY edges never hold
 * a task back; they only feed its due date.
 */
export function isReady(deps: { kind: TaskDependencyKind; status: TaskStatus }[]): boolean {
  return deps.every((d) => d.kind !== "BLOCKING" || isSatisfied(d.status));
}

/**
 * Longest path through the graph in business days, counting each task's
 * offset once. Used for the "about N business days" estimate in the Apply
 * preview; not a schedule, just a floor.
 */
export function criticalPathBusinessDays<K>(
  tasks: { key: K; days: number }[],
  edges: DepEdge<K>[],
): number {
  const keys = tasks.map((t) => t.key);
  const order = topoSort(keys, edges);
  const days = new Map(tasks.map((t) => [t.key, Math.max(0, t.days)]));
  const preds = new Map<K, K[]>(keys.map((k) => [k, []]));
  for (const e of edges) {
    if (e.kind !== "BLOCKING") continue;
    if (preds.has(e.task) && days.has(e.dependsOn)) preds.get(e.task)!.push(e.dependsOn);
  }
  const longest = new Map<K, number>();
  let best = 0;
  for (const k of order) {
    const base = Math.max(0, ...(preds.get(k) ?? []).map((p) => longest.get(p) ?? 0));
    const total = base + (days.get(k) ?? 0);
    longest.set(k, total);
    if (total > best) best = total;
  }
  return best;
}
