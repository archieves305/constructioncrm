import { z } from "zod/v4";

export const createTaskSchema = z.object({
  leadId: z.string().optional(),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  assignedUserId: z.string().optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
