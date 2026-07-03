import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

const ISSUE_TYPES = [
  "OFFICE_FOLLOW_UP",
  "CO_REVIEW",
  "SAFETY",
  "MATERIAL_REQUEST",
  "INSPECTION_REMINDER",
] as const;

const TYPE_LABELS: Record<string, string> = {
  OFFICE_FOLLOW_UP: "Field",
  CO_REVIEW: "Field: CO review",
  SAFETY: "Field: Safety",
  MATERIAL_REQUEST: "Field: Materials",
  INSPECTION_REMINDER: "Field: Inspection",
};

const createSchema = z.object({
  type: z.enum(ISSUE_TYPES).default("OFFICE_FOLLOW_UP"),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assignedUserId: z.string().trim().max(40).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  dailyLogId: z.string().trim().max(40).optional().nullable(),
});

export async function GET(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "read");
  if ("response" in ctx) return ctx.response;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const type = searchParams.get("type");

  const issues = await prisma.fieldIssue.findMany({
    where: {
      jobId,
      ...(status ? { status: status as never } : {}),
      ...(type ? { type: type as never } : {}),
    },
    include: {
      raisedBy: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      task: { select: { id: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(issues);
}

// Creating an issue also creates a linked office Task (so it lands in the
// existing task queue) whenever it's assigned or is an office follow-up.
// Sync is one-way: resolving the issue completes the Task, never the reverse.
export async function POST(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const v = await validateBody(request, createSchema);
  if (!v.ok) return v.response;
  const d = v.data;

  const issue = await prisma.$transaction(async (tx) => {
    const created = await tx.fieldIssue.create({
      data: {
        jobId,
        dailyLogId: d.dailyLogId || null,
        type: d.type,
        title: d.title,
        description: d.description || null,
        priority: d.priority,
        assignedUserId: d.assignedUserId || null,
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
        raisedByUserId: ctx.session.user.id,
      },
    });

    const task = await tx.task.create({
      data: {
        jobId,
        title: `[${TYPE_LABELS[d.type]}] ${d.title}`,
        description: d.description || null,
        priority: d.priority,
        assignedUserId: d.assignedUserId || null,
        createdByUserId: ctx.session.user.id,
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
      },
    });
    return tx.fieldIssue.update({
      where: { id: created.id },
      data: { taskId: task.id },
      include: {
        raisedBy: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        task: { select: { id: true, status: true } },
      },
    });
  });

  await recordAudit({
    actorUserId: ctx.session.user.id,
    entityType: "FieldIssue",
    entityId: issue.id,
    action: "create",
    after: { jobId, type: issue.type, title: issue.title },
  });

  return NextResponse.json(issue, { status: 201 });
}
