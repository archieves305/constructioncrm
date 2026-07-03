import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";

type Context = { params: Promise<{ id: string }> };

// Which field users (crew leads) run this job. ADMIN/MANAGER manage.
const MANAGE_ROLES = new Set(["ADMIN", "MANAGER"]);

export async function GET(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id: jobId } = await context.params;
  const assignments = await prisma.jobFieldAssignment.findMany({
    where: { jobId },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(assignments);
}

const createSchema = z.object({ userId: z.string().min(1) });

export async function POST(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const { id: jobId } = await context.params;
  const v = await validateBody(request, createSchema);
  if (!v.ok) return v.response;

  const [job, user] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id: v.data.userId },
      select: { id: true, isActive: true },
    }),
  ]);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!user || !user.isActive) return badRequest("User not found or inactive");

  const assignment = await prisma.jobFieldAssignment.upsert({
    where: { jobId_userId: { jobId, userId: v.data.userId } },
    create: { jobId, userId: v.data.userId, createdByUserId: session.user.id },
    update: {},
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "JobFieldAssignment",
    entityId: assignment.id,
    action: "assign",
    after: { jobId, userId: v.data.userId },
  });

  return NextResponse.json(assignment, { status: 201 });
}

export async function DELETE(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!MANAGE_ROLES.has(session.user.role)) return forbidden();

  const { id: jobId } = await context.params;
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) return badRequest("userId is required");

  const existing = await prisma.jobFieldAssignment.findUnique({
    where: { jobId_userId: { jobId, userId } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.jobFieldAssignment.delete({ where: { id: existing.id } });

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "JobFieldAssignment",
    entityId: existing.id,
    action: "unassign",
    before: { jobId, userId },
  });

  return NextResponse.json({ ok: true });
}
