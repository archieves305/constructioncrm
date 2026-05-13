import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { emitPermitEvent, statusEventName } from "@/lib/follow-ups/permit-events";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  const previous = await prisma.jobPermit.findUnique({
    where: { id },
    select: { status: true },
  });

  const updateData: Record<string, unknown> = {};
  if (body.status) updateData.status = body.status;
  if (body.municipality !== undefined) updateData.municipality = body.municipality;
  if (body.permitType !== undefined) updateData.permitType = body.permitType;
  if (body.permitNumber !== undefined) updateData.permitNumber = body.permitNumber;
  if (body.submittedDate !== undefined) {
    updateData.submittedDate = body.submittedDate ? new Date(body.submittedDate) : null;
  }
  if (body.expectedApprovalDate !== undefined) {
    updateData.expectedApprovalDate = body.expectedApprovalDate
      ? new Date(body.expectedApprovalDate)
      : null;
  }
  if (body.approvedDate !== undefined) {
    updateData.approvedDate = body.approvedDate ? new Date(body.approvedDate) : null;
  }
  if (body.expirationDate !== undefined) {
    updateData.expirationDate = body.expirationDate ? new Date(body.expirationDate) : null;
  }
  if (body.finalPassedDate !== undefined) {
    updateData.finalPassedDate = body.finalPassedDate ? new Date(body.finalPassedDate) : null;
  }
  if (body.assignedUserId !== undefined) updateData.assignedUserId = body.assignedUserId || null;
  if (body.inspectorName !== undefined) updateData.inspectorName = body.inspectorName;
  if (body.permitFee !== undefined) {
    updateData.permitFee = body.permitFee == null || body.permitFee === "" ? null : body.permitFee;
  }
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

  // Fire automation on a real status transition (skip no-ops + same-status saves).
  if (body.status && previous && previous.status !== body.status) {
    const event = statusEventName(body.status);
    if (event) await emitPermitEvent(event, permit.id);
  }

  return NextResponse.json(permit);
}
