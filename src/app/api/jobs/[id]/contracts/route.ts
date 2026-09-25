import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageContracts, canViewContracts } from "@/lib/customer-contracts/access";
import { createContractDraft, listContractsForJob } from "@/lib/customer-contracts/service";
import { contractErrorResponse } from "@/lib/customer-contracts/route-helpers";
import { createContractSchema } from "@/lib/validators/customer-contract";

// GET /api/jobs/[id]/contracts — every customer contract on the job, newest first.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(await listContractsForJob(id));
}

// POST /api/jobs/[id]/contracts — draft a contract from one of the customer's estimates.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const v = await validateBody(request, createContractSchema);
  if (!v.ok) return v.response;
  try {
    const result = await createContractDraft({
      jobId: id,
      userId: session.user.id,
      source: { estimateId: v.data.estimateId, roofEstimateId: v.data.roofEstimateId, includeOptionalItemIds: v.data.includeOptionalItemIds },
      templateKey: v.data.templateKey,
      paymentSchedule: v.data.paymentSchedule ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return contractErrorResponse(err, "contracts.create");
  }
}
