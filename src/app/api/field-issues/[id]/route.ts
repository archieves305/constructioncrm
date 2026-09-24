import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { recordAudit } from "@/lib/audit/record";
import { updateTask } from "@/lib/tasks/update";
import { logger } from "@/lib/logger";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedUserId: z.string().trim().max(40).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
});

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  const issue = await prisma.fieldIssue.findUnique({
    where: { id },
    include: {
      job: { select: { id: true, jobNumber: true, title: true } },
      raisedBy: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      task: { select: { id: true, status: true } },
      photos: { select: { id: true, caption: true } },
    },
  });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(issue.jobId, "read");
  if ("response" in ctx) return ctx.response;
  return NextResponse.json(issue);
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const issue = await prisma.fieldIssue.findUnique({ where: { id } });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireJobFieldAccess(issue.jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, patchSchema);
  if (!v.ok) return v.response;
  const d = v.data;

  const data: Record<string, unknown> = {};
  if (d.status !== undefined) data.status = d.status;
  if (d.priority !== undefined) data.priority = d.priority;
  if (d.assignedUserId !== undefined) data.assignedUserId = d.assignedUserId || null;
  if (d.dueAt !== undefined) data.dueAt = d.dueAt ? new Date(d.dueAt) : null;
  if (d.description !== undefined) data.description = d.description || null;

  const resolving = d.status === "COMPLETED" && issue.status !== "COMPLETED";
  if (resolving) {
    data.resolvedAt = new Date();
    data.resolvedByUserId = ctx.session.user.id;
  }

  const updated = await prisma.fieldIssue.update({
    where: { id },
    data,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      task: { select: { id: true, status: true } },
    },
  });

  // Resolving the issue completes its office task through the normal path so
  // the task gets a STATUS_CHANGED row and the completion mail — a bare
  // status flip used to leave the office none the wiser. Access was checked
  // by requireJobFieldAccess above, so no task-level authorize. Best-effort:
  // the issue is resolved either way.
  if (resolving && updated.taskId && updated.task?.status !== "COMPLETED") {
    try {
      await updateTask({
        id: updated.taskId,
        input: { status: "COMPLETED" },
        actorUserId: ctx.session.user.id,
      });
    } catch (err) {
      logger.exception(err, { where: "field-issues.resolve", issueId: id, taskId: updated.taskId });
    }
  }

  if (resolving) {
    await recordAudit({
      actorUserId: ctx.session.user.id,
      entityType: "FieldIssue",
      entityId: id,
      action: "resolve",
      after: { title: issue.title },
    });
  }

  return NextResponse.json(updated);
}
