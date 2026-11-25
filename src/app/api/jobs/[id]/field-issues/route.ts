import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { withIdempotency } from "@/lib/api/idempotency";
import { createFieldIssue, FIELD_ISSUE_INCLUDE } from "@/lib/field-issues/create";

type Context = { params: Promise<{ id: string }> };

const ISSUE_TYPES = [
  "OFFICE_FOLLOW_UP",
  "CO_REVIEW",
  "SAFETY",
  "MATERIAL_REQUEST",
  "INSPECTION_REMINDER",
  "PUNCH",
] as const;

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
  const ctx = await requireJobFieldAccess(jobId, "contribute");
  if ("response" in ctx) return ctx.response;

  return withIdempotency(request, ctx.session.user.id, `POST /api/jobs/${jobId}/field-issues`, async () => {
    const v = await validateBody(request, createSchema);
    if (!v.ok) return v.response;
    const d = v.data;

    // A phone resending an issue it already made: hand back that issue.
    if (d.id) {
      const existing = await prisma.fieldIssue.findUnique({
        where: { id: d.id },
        include: FIELD_ISSUE_INCLUDE,
      });
      if (existing) {
        if (existing.jobId !== jobId || existing.raisedByUserId !== ctx.session.user.id) {
          return NextResponse.json({ error: "That id is already used", code: "id_taken" }, { status: 409 });
        }
        return NextResponse.json(existing, { status: 200 });
      }
    }

    const issue = await createFieldIssue(
      {
        id: d.id,
        jobId,
        dailyLogId: d.dailyLogId || null,
        type: d.type,
        title: d.title,
        description: d.description || null,
        priority: d.priority,
        assignedUserId: d.assignedUserId || null,
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
      },
      { id: ctx.session.user.id, role: ctx.session.user.role },
      ctx.job,
    );

    return NextResponse.json(issue, { status: 201 });
  });
}
