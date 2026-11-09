/**
 * List sorting kept in the URL (`?sort=contract&dir=desc`). Pure and
 * client-safe: the page reads the state, the header toggles it, and the API
 * maps the key through its own allow-list (lib/jobs/sort.ts, …) — a column
 * name from the URL never reaches Prisma.
 */
export type SortDir = "asc" | "desc";
export type SortState<K extends string = string> = { key: K; dir: SortDir };

type Gettable = { get(name: string): string | null };

/** The sort in `sp`, or `fallback` when the key is not one of `keys`. */
export function parseSort<K extends string>(sp: Gettable, keys: readonly K[], fallback: SortState<K>): SortState<K> {
  const key = sp.get("sort");
  if (!key || !(keys as readonly string[]).includes(key)) return fallback;
  const dir = sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : fallback.key === key ? fallback.dir : "asc";
  return { key: key as K, dir };
}

/** Clicking a header: the same column flips direction, another column starts at its natural direction. */
export function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDir = "asc"): SortState<K> {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: firstDir };
}

/** URL values for a sort: none when it is the list's default. */
export function sortParams<K extends string>(s: SortState<K>, fallback: SortState<K>): { sort: string | null; dir: string | null } {
  return s.key === fallback.key && s.dir === fallback.dir ? { sort: null, dir: null } : { sort: s.key, dir: s.dir };
}

/** The keys each list can be sorted by, shared by its page and its route. */
export const JOB_SORT_KEYS = ["created", "property", "customer", "service", "stage", "contract", "balance", "nextAction", "rep"] as const;
export type JobSortKey = (typeof JOB_SORT_KEYS)[number];
export const JOB_SORT_DEFAULT: SortState<JobSortKey> = { key: "created", dir: "desc" };

export const LEAD_SORT_KEYS = ["created", "name", "address", "stage", "source", "assignee", "value", "followUp"] as const;
export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];
export const LEAD_SORT_DEFAULT: SortState<LeadSortKey> = { key: "created", dir: "desc" };

export const TASK_SORT_KEYS = ["due", "priority", "title", "created", "assignee"] as const;
export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];
export const TASK_SORT_DEFAULT: SortState<TaskSortKey> = { key: "due", dir: "asc" };
