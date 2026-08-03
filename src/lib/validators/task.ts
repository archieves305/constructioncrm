import { z } from "zod/v4";

export const createTaskSchema = z.object({
  leadId: z.string().optional(),
  jobId: z.string().optional(),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  assignedUserId: z.string().optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
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
