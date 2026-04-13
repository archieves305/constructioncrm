import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  if (body.status) updateData.status = body.status;
  if (body.permitNumber) updateData.permitNumber = body.permitNumber;
  if (body.approvedDate) updateData.approvedDate = new Date(body.approvedDate);
  if (body.finalPassedDate) updateData.finalPassedDate = new Date(body.finalPassedDate);
  if (body.assignedUserId !== undefined) updateData.assignedUserId = body.assignedUserId;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const permit = await prisma.jobPermit.update({
    where: { id },
    data: updateData,
    include: {
      job: { select: { id: true, jobNumber: true, leadId: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
    },
  });

  if (body.status && permit.job) {
    await prisma.activityLog.create({
      data: {
        leadId: permit.job.leadId,
        activityType: "PERMIT_ADDED",
        title: `Permit status → ${body.status}`,
        description: body.notes || undefined,
        createdByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json(permit);
}
