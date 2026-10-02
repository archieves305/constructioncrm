import type { TaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { createTask } from "@/lib/tasks/create";
import { updateTask } from "@/lib/tasks/update";

/**
 * A labor-contract schedule line with an owner.
 *
 * Naming a person on a line raises an ordinary CRM task for them — the usual
 * assignment email, their task list, the calendar — and the two stay in step:
 * the line's assignee and due date drive the task; completing either
 * completes the other. A line with nobody on it has no task.
 */
export const lineSourceKey = (lineId: string) => `labor-contract-task:${lineId}`;

const dayString = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** What to do to the linked task for the line as it now stands. Pure. */
export function planLineSync(line: {
  assignedUserId: string | null;
  status: string;
  hasTask: boolean;
  taskStatus: TaskStatus | null;
}): "create" | "update" | "complete" | "none" {
  const taskOpen = line.taskStatus !== null && line.taskStatus !== "COMPLETED" && line.taskStatus !== "CANCELLED";
  if (line.status === "COMPLETE") return line.hasTask && taskOpen ? "complete" : "none";
  if (!line.hasTask) return line.assignedUserId ? "create" : "none";
  // A closed task is not reopened by editing the line; a reopened line with a new owner gets a fresh task.
  if (!taskOpen) return line.assignedUserId ? "create" : "none";
  return "update";
}

/** Bring the line's CRM task in line with the line. Best-effort: the line was saved whatever happens here. */
export async function syncScheduleTask(lineId: string, actorUserId: string): Promise<void> {
  try {
    const line = await prisma.laborContractTask.findUnique({
      where: { id: lineId },
      select: {
        id: true, name: true, room: true, description: true, status: true, assignedUserId: true, dueDate: true,
        task: { select: { id: true, status: true, assignedUserId: true, dueAt: true } },
        laborContract: { select: { jobId: true, label: true, crew: { select: { name: true } } } },
      },
    });
    if (!line) return;
    const action = planLineSync({ assignedUserId: line.assignedUserId, status: line.status, hasTask: line.task !== null, taskStatus: line.task?.status ?? null });

    if (action === "create") {
      const crew = line.laborContract.crew?.name ?? line.laborContract.label ?? "Labor";
      const task = await createTask(
        {
          title: `${line.name}${line.room ? ` (${line.room})` : ""} — ${crew}`,
          description: [line.description, "A line on the crew's labor contract. Completing this task marks the line complete; see the job's Field → Labor tab."].filter(Boolean).join("\n\n"),
          dueAt: line.dueDate,
          assignedUserId: line.assignedUserId,
          createdByUserId: actorUserId,
          jobId: line.laborContract.jobId,
          source: "auto",
          sourceKey: lineSourceKey(line.id),
        },
        { actorUserId },
      );
      await prisma.laborContractTask.update({ where: { id: line.id }, data: { taskId: task.id } });
    } else if (action === "update" && line.task) {
      const input: { assignedUserId?: string | null; dueAt?: string | null } = {};
      if (line.task.assignedUserId !== line.assignedUserId) input.assignedUserId = line.assignedUserId;
      if (dayString(line.task.dueAt) !== dayString(line.dueDate)) input.dueAt = dayString(line.dueDate);
      if (Object.keys(input).length > 0) await updateTask({ id: line.task.id, input, actorUserId });
    } else if (action === "complete" && line.task) {
      await updateTask({ id: line.task.id, input: { status: "COMPLETED" }, actorUserId });
    }
  } catch (err) {
    logger.exception(err, { where: "labor.syncScheduleTask", lineId });
  }
}

/** The line is being deleted: its task goes with it. */
export async function cancelScheduleTask(lineId: string, actorUserId: string): Promise<void> {
  try {
    const line = await prisma.laborContractTask.findUnique({ where: { id: lineId }, select: { task: { select: { id: true, status: true } } } });
    if (line?.task && line.task.status !== "COMPLETED" && line.task.status !== "CANCELLED") {
      await updateTask({ id: line.task.id, input: { status: "CANCELLED" }, actorUserId });
    }
  } catch (err) {
    logger.exception(err, { where: "labor.cancelScheduleTask", lineId });
  }
}

/** The line's task was completed from the task side: the line is complete too. Called from the task hook. */
export async function onScheduleTaskClosed(taskId: string, to: TaskStatus): Promise<void> {
  if (to !== "COMPLETED") return;
  try {
    await prisma.laborContractTask.updateMany({ where: { taskId, status: { not: "COMPLETE" } }, data: { status: "COMPLETE" } });
  } catch (err) {
    logger.exception(err, { where: "labor.onScheduleTaskClosed", taskId });
  }
}
