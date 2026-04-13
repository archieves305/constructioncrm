import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  if (!body.type) return badRequest("type is required");

  const inspection = await prisma.inspection.create({
    data: {
      jobId: id,
      type: body.type,
      scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : null,
      notes: body.notes,
      inspectorId: body.inspectorId,
    },
  });

  const job = await prisma.job.findUnique({ where: { id }, select: { leadId: true } });
  if (job) {
    await prisma.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "INSPECTION_SCHEDULED",
        title: `Inspection scheduled: ${body.type}`,
        createdByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json(inspection, { status: 201 });
}
