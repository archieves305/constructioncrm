import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { recordAudit } from "@/lib/audit/record";
import { createTask } from "@/lib/tasks/create";
import { withIdempotency } from "@/lib/api/idempotency";
import { userForJobRole } from "@/lib/workflows/roles";

type Context = { params: Promise<{ id: string }> };

const ISSUE_TYPES = [
  "OFFICE_FOLLOW_UP",
  "CO_REVIEW",
  "SAFETY",
  "MATERIAL_REQUEST",
  "INSPECTION_REMINDER",
  "PUNCH",
] as const;

const TYPE_LABELS: Record<string, string> = {
  OFFICE_FOLLOW_UP: "Field",
  CO_REVIEW: "Field: CO review",
  SAFETY: "Field: Safety",
  MATERIAL_REQUEST: "Field: Materials",
  INSPECTION_REMINDER: "Field: Inspection",
  PUNCH: "Punch",
};

/** A phone-made id (same form as field photos' client ids), so a resend finds the issue it already made. */
const CLIENT_ID_RE = /^[a-z][a-z0-9]{19,31}$/;

const createSchema = z.object({
  type: z.enum(ISSUE_TYPES).default("OFFICE_FOLLOW_UP"),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assignedUserId: z.string().trim().max(40).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  dailyLogId: z.string().trim().max(40).optional().nullable(),
  /** Phone-made id; photos queued behind the issue refer to it before it exists. */
  id: z.string().regex(CLIENT_ID_RE).optional(),
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
// existing task queue). Resolving the issue completes the Task, and completing
// the Task resolves the issue — both through `updateTask`, which guards
// against ping-pong.
export async function POST(request: NextRequest, context: Context) {
  const { id: jobId } = await context.params;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  return withIdempotency(request, ctx.session.user.id, `POST /api/jobs/${jobId}/field-issues`, async () => {
    const v = await validateBody(request, createSchema);
    if (!v.ok) return v.response;
    const d = v.data;

    // A phone resending an issue it already made: hand back that issue.
    if (d.id) {
      const existing = await prisma.fieldIssue.findUnique({
        where: { id: d.id },
        include: {
          raisedBy: { select: { id: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          task: { select: { id: true, status: true } },
        },
      });
      if (existing) {
        if (existing.jobId !== jobId || existing.raisedByUserId !== ctx.session.user.id) {
          return NextResponse.json({ error: "That id is already used", code: "id_taken" }, { status: 409 });
        }
        return NextResponse.json(existing, { status: 200 });
      }
    }

    // A material request nobody was named for goes to whoever buys for the job
    // (the Purchasing slot, else the company default), not into an unowned task.
    // A problem a crew lead reports with nobody named goes to the job's PM
    // (purchasing first for materials): a crew never leaves it unowned.
    const crewRaised = ctx.session.user.role === "CREW_LEAD";
    const assignedUserId =
      d.assignedUserId ||
      (d.type === "MATERIAL_REQUEST" ? await userForJobRole(jobId, "PURCHASING") : null) ||
      (crewRaised ? ctx.job.projectManagerId : null);

    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.fieldIssue.create({
        data: {
          ...(d.id ? { id: d.id } : {}),
          jobId,
          dailyLogId: d.dailyLogId || null,
          type: d.type,
          title: d.title,
          description: d.description || null,
          priority: d.priority,
          assignedUserId,
          dueAt: d.dueAt ? new Date(d.dueAt) : null,
          raisedByUserId: ctx.session.user.id,
        },
      });

      // Through the shared creator so the task gets its CREATED/ASSIGNED
      // timeline rows and the assignee is actually told. Mail is deferred past
      // the response, i.e. after this transaction commits.
      const task = await createTask(
        {
          jobId,
          dailyLogId: d.dailyLogId || null,
          title: `[${TYPE_LABELS[d.type]}] ${d.title}`,
          description: d.description || null,
          priority: d.priority,
          assignedUserId,
          createdByUserId: ctx.session.user.id,
          dueAt: d.dueAt ? new Date(d.dueAt) : null,
          source: "field_issue",
        },
        { db: tx, actorUserId: ctx.session.user.id },
      );
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
  });
}
