import { settleJobGates } from "@/lib/workflows/gates";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { canWriteProduction } from "@/lib/access/roles";
import { isPermitStatus, statusStamps } from "@/lib/permits/rules";
import { inspectionStepsForJob } from "@/lib/permits/service";

/** The job's permits with their inspections, and the open workflow inspection steps a result could belong to. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;
  const [permits, steps, feeCharges] = await Promise.all([
    prisma.jobPermit.findMany({
      where: { jobId: id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        inspections: { orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }], include: { task: { select: { id: true, title: true, status: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    inspectionStepsForJob(id),
    // What was actually paid: permit-fee charges already on the job's costs. A fee typed on a permit never becomes one.
    prisma.jobExpense.findMany({
      where: { jobId: id, type: "PERMIT_FEE", status: "APPROVED" },
      select: { id: true, vendor: true, description: true, amount: true, incurredDate: true },
      orderBy: { incurredDate: "asc" },
    }),
  ]);
  return NextResponse.json({ permits, steps, feeCharges, canEdit: canWriteProduction(session.user.role) });
}

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

  // A permit number on file completes the step that waits on it (the job's, and a linked violation case's).
  await settleJobGates(permit.jobId, session.user.id);

  return NextResponse.json(permit, { status: 201 });
}
