import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { emitPermitEvent } from "@/lib/follow-ups/permit-events";

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
      permitType: body.permitType ?? null,
      permitNumber: body.permitNumber ?? null,
      submittedDate: body.submittedDate ? new Date(body.submittedDate) : new Date(),
      expectedApprovalDate: body.expectedApprovalDate ? new Date(body.expectedApprovalDate) : null,
      expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
      status: body.status || "APPLIED",
      assignedUserId: body.assignedUserId ?? null,
      inspectorName: body.inspectorName ?? null,
      permitFee: body.permitFee != null && body.permitFee !== "" ? body.permitFee : null,
      notes: body.notes ?? null,
    },
  });

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

  // Fire automation: PERMIT_CREATED for any active rule.
  await emitPermitEvent("PERMIT_CREATED", permit.id);

  return NextResponse.json(permit, { status: 201 });
}
