import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { recordAudit } from "@/lib/audit/record";

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

  const updated = await prisma.$transaction(async (tx) => {
    const out = await tx.fieldIssue.update({
      where: { id },
      data,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        task: { select: { id: true, status: true } },
      },
    });
    // One-way sync: resolving the issue completes its office task.
    if (resolving && out.taskId) {
      await tx.task.update({
        where: { id: out.taskId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
    return out;
  });

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
