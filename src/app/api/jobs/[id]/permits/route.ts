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

  if (!body.municipality) return badRequest("municipality is required");

  const permit = await prisma.jobPermit.create({
    data: {
      jobId: id,
      municipality: body.municipality,
      permitType: body.permitType,
      permitNumber: body.permitNumber,
      submittedDate: body.submittedDate ? new Date(body.submittedDate) : new Date(),
      status: body.status || "APPLIED",
      assignedUserId: body.assignedUserId,
      notes: body.notes,
    },
  });

  // Log activity
  const job = await prisma.job.findUnique({ where: { id }, select: { leadId: true } });
  if (job) {
    await prisma.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "PERMIT_ADDED",
        title: `Permit submitted: ${body.permitType || "General"}`,
        description: `Municipality: ${body.municipality}`,
        createdByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json(permit, { status: 201 });
}
