import { settleJobGates } from "@/lib/workflows/gates";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { canWriteProduction } from "@/lib/access/roles";
import { statusStamps } from "@/lib/permits/rules";
import { readPermitCreate } from "@/lib/permits/create-input";
import { inspectionStepsForJob, PermitError, recordFields } from "@/lib/permits/service";
import type { Prisma } from "@/generated/prisma/client";

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
  const body = await request.json().catch(() => null);
  const checked = readPermitCreate(body);
  if (!checked.ok) return badRequest(checked.error);
  const input = checked.value;

  let record: Prisma.JobPermitUncheckedUpdateInput;
  try {
    record = await recordFields(body as Record<string, unknown>);
  } catch (err) {
    if (err instanceof PermitError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  // a permit still being put together has not been submitted
  const status = input.status;
  const preparing = status === "PREPARING";
  // A permit entered as already issued or final carries today's date unless one is given.
  const approvedDate = input.approvedDate;
  const stamps = statusStamps(status, { approvedDate, finalPassedDate: null }, new Date());

  const permit = await prisma.jobPermit.create({
    data: {
      jobId: id,
      municipality: (record.municipality as string | undefined) ?? input.municipality ?? "",
      permitType: input.permitType,
      permitNumber: input.permitNumber,
      submittedDate: input.submittedDate !== undefined ? input.submittedDate : preparing ? null : new Date(),
      expectedApprovalDate: input.expectedApprovalDate,
      expirationDate: input.expirationDate,
      approvedDate: approvedDate ?? stamps.approvedDate ?? null,
      finalPassedDate: stamps.finalPassedDate ?? null,
      status,
      assignedUserId: input.assignedUserId,
      inspectorName: input.inspectorName,
      permitFee: input.permitFee,
      notes: input.notes,
      jurisdictionId: (record.jurisdictionId as string | null | undefined) ?? null,
      permitTypeKey: (record.permitTypeKey as string | null | undefined) ?? null,
      applicationNumber: (record.applicationNumber as string | null | undefined) ?? null,
      scopeDescription: (record.scopeDescription as string | null | undefined) ?? null,
      valuation: (record.valuation as string | null | undefined) ?? null,
      ...(record.permitType !== undefined && !input.permitType ? { permitType: record.permitType as string } : {}),
    },
  });

  const job = await prisma.job.findUnique({ where: { id }, select: { leadId: true } });
  if (job) {
    await prisma.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "PERMIT_ADDED",
        title: `${preparing ? "Permit started" : "Permit submitted"}: ${permit.permitType || "General"}`,
        description: `Municipality: ${permit.municipality}`,
        createdByUserId: session.user.id,
      },
    });
  }

  // A permit number on file completes the step that waits on it (the job's, and a linked violation case's).
  await settleJobGates(permit.jobId, session.user.id);

  return NextResponse.json(permit, { status: 201 });
}
