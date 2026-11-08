import { z } from "zod/v4";

/**
 * Per-field conflict check for task edits made somewhere the task may have
 * changed meanwhile, such as a phone that was offline
 * (CAREYOS_MOBILE_APP_PLAN.md §F.4).
 *
 * The caller sends, with its PATCH, the values it last saw for the fields it
 * is changing (`expect`). Then:
 *   - a field nobody else changed is applied as usual;
 *   - a field already holding the value asked for is fine (the phone's "Done"
 *     on a task finished on the web is a success, not an error);
 *   - a field someone else changed to something else is a conflict: nothing
 *     is written and the caller is told which fields, with the current task.
 * Fields the caller did not mention (a due date moved on the web while the
 * crew lead marks it done) never conflict.
 */

export const EXPECTABLE_FIELDS = [
  "status",
  "assignedUserId",
  "dueAt",
  "blockedReason",
  "title",
  "description",
  "priority",
] as const;
export type ExpectableField = (typeof EXPECTABLE_FIELDS)[number];

export const expectSchema = z
  .object({
    status: z.enum(["PENDING", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]).optional(),
    assignedUserId: z.string().nullable().optional(),
    dueAt: z.string().nullable().optional(),
    blockedReason: z.string().nullable().optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  })
  .strict();
export type Expectations = z.infer<typeof expectSchema>;

type Value = string | Date | null | undefined;
export type CurrentTask = Partial<Record<ExpectableField, Value>>;

/** Equal as the task would store them: instants by time, empty text as none. */
export function sameValue(field: ExpectableField, a: Value, b: Value): boolean {
  const norm = (v: Value) => (v === undefined || v === "" ? null : v);
  const x = norm(a);
  const y = norm(b);
  if (x === null || y === null) return x === y;
  if (field === "dueAt") {
    const tx = x instanceof Date ? x.getTime() : Date.parse(x);
    const ty = y instanceof Date ? y.getTime() : Date.parse(y);
    // A bare day ("2026-11-08") is compared by day, as applySchedule reads it.
    if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return new Date(ty).toISOString().slice(0, 10) === x;
    if (typeof y === "string" && /^\d{4}-\d{2}-\d{2}$/.test(y)) return new Date(tx).toISOString().slice(0, 10) === y;
    return tx === ty;
  }
  return String(x) === String(y);
}

export type ExpectResult =
  | { ok: true; noop: boolean }
  | { ok: false; conflicts: ExpectableField[] };

export function checkExpectations(
  current: CurrentTask,
  expect: Expectations | undefined,
  patch: Partial<Record<string, unknown>>,
): ExpectResult {
  const conflicts: ExpectableField[] = [];
  for (const field of EXPECTABLE_FIELDS) {
    if (!expect || !(field in expect)) continue;
    const cur = current[field];
    if (sameValue(field, cur, expect[field] as Value)) continue;
    // Someone else moved it. Fine only if it already holds what was asked.
    if (field in patch && sameValue(field, cur, patch[field] as Value)) continue;
    conflicts.push(field);
  }
  if (conflicts.length) return { ok: false, conflicts };

  // Nothing to do when every field asked for already holds its value: the
  // edit is not written again (no duplicate timeline lines, no reopen).
  const fields = Object.keys(patch).filter((k) => patch[k] !== undefined);
  const noop =
    expect !== undefined &&
    fields.length > 0 &&
    fields.every(
      (k) => (EXPECTABLE_FIELDS as readonly string[]).includes(k) && sameValue(k as ExpectableField, current[k as ExpectableField], patch[k] as Value),
    );
  return { ok: true, noop };
}
