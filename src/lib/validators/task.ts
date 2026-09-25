import { z } from "zod/v4";

export const createTaskSchema = z.object({
  leadId: z.string().optional(),
  jobId: z.string().optional(),
  estimateId: z.string().optional(),
  invoiceId: z.string().optional(),
  prospectId: z.string().optional(),
  dailyLogId: z.string().optional(),
  violationCaseId: z.string().optional(),
  violationItemId: z.string().optional(),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  assignedUserId: z.string().optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  watcherUserIds: z.array(z.string().min(1)).max(20).optional(),
  /** yyyy-MM-dd. Delivered with the morning digest of that day. */
  remindAt: z.string().optional(),
});

/**
 * `assignedUserId` and `dueAt` are nullable here, not merely optional.
 *
 * The distinction is load-bearing: the UI sends an explicit `null` to unassign
 * a task or clear its due date. Inheriting the create schema's
 * `z.string().optional()` rejected those as "expected string, received null",
 * so both actions 400'd and surfaced only as a "Update failed" toast. Optional
 * means "leave alone"; nullable means "clear it".
 */
export const updateTaskSchema = createTaskSchema.partial().extend({
  assignedUserId: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]).optional(),
  blockedReason: z.string().nullable().optional(),
  // Redeclared WITHOUT createTaskSchema's `.default("MEDIUM")`. `.partial()`
  // does not strip a default, so the create schema's leaked into every PATCH:
  // any update that did not mention priority still parsed to
  // `priority: "MEDIUM"` and the route spread that into the write. Ticking an
  // URGENT task complete quietly downgraded it. Defaults belong on create only.
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  remindAt: z.string().nullable().optional(),
  // ── Workflow steps ──
  /** Required when cancelling a workflow step: CANCELLED + skipReason = Skipped. */
  skipReason: z.string().trim().max(2000).nullable().optional(),
  /** false re-attaches the due date to the engine and recomputes it. */
  dueLocked: z.boolean().optional(),
  /** Tick/untick checklist items by key; unmentioned items are left alone. */
  checklist: z.array(z.object({ key: z.string().min(1), done: z.boolean() })).max(100).optional(),
  /** ADMIN/MANAGER only: complete despite missing evidence, with a stated reason. */
  evidenceOverrideReason: z.string().trim().min(1).max(2000).optional(),
});

export const nudgeSchema = z.object({
  message: z.string().trim().max(1000).optional(),
});

export const taskNoteSchema = z.object({
  body: z.string().trim().min(1, "A note cannot be empty").max(10_000),
});

export const taskWatcherSchema = z.object({
  userId: z.string().min(1),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskNoteInput = z.infer<typeof taskNoteSchema>;
