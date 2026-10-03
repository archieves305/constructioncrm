import { settleJobGates } from "@/lib/workflows/gates";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { emitPermitEvent } from "@/lib/follow-ups/permit-events";
import { guardJob } from "@/lib/access/records";
import { isPermitStatus, statusStamps } from "@/lib/permits/rules";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "write");
  if (denied) return denied;
  const body = await request.json();

  if (!body.municipality) return badRequest("municipality is required");
  const status = body.status || "APPLIED";
  if (!isPermitStatus(status)) return badRequest("status is not a permit status");
  // A permit entered as already issued or final carries today's date unless one is given.
  const approvedDate = body.approvedDate ? new Date(body.approvedDate) : null;
  const stamps = statusStamps(status, { approvedDate, finalPassedDate: null }, new Date());

  const permit = await prisma.jobPermit.create({
    data: {
      jobId: id,
      municipality: body.municipality,
      permitType: body.permitType ?? null,
      permitNumber: body.permitNumber?.trim() || null,
      submittedDate: body.submittedDate ? new Date(body.submittedDate) : new Date(),
      expectedApprovalDate: body.expectedApprovalDate ? new Date(body.expectedApprovalDate) : null,
      expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
      approvedDate: approvedDate ?? stamps.approvedDate ?? null,
      finalPassedDate: stamps.finalPassedDate ?? null,
      status,
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
  // A permit number on file completes the step that waits on it (the job's, and a linked violation case's).
  await settleJobGates(permit.jobId, session.user.id);

  return NextResponse.json(permit, { status: 201 });
}
