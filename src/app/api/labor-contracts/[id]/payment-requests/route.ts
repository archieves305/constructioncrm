import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardJob } from "@/lib/access/records";
import { createPaymentRequest, PaymentRequestError, REQUEST_INCLUDE } from "@/lib/labor/payment-requests";
import { userForJobRole } from "@/lib/workflows/roles";

const createSchema = z.object({
  amount: z.number().positive("Enter the amount to pay"),
  note: z.string().max(2000).nullable().optional(),
  /** yyyy-MM-dd */
  neededBy: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
  lineIds: z.array(z.string()).max(200).optional(),
});

async function jobIdOf(contractId: string): Promise<string | null> {
  const c = await prisma.laborContract.findUnique({ where: { id: contractId }, select: { jobId: true } });
  return c?.jobId ?? null;
}

// GET — the contract's payment requests, newest first, and who a new one would go to by default.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const jobId = await jobIdOf(id);
  if (!jobId) return NextResponse.json({ error: "Labor contract not found" }, { status: 404 });
  const denied = await guardJob(session.user, jobId, "read");
  if (denied) return denied;

  const [requests, defaultAssigneeId] = await Promise.all([
    prisma.laborPaymentRequest.findMany({ where: { laborContractId: id }, orderBy: { createdAt: "desc" }, include: REQUEST_INCLUDE }),
    userForJobRole(jobId, "ACCOUNTING"),
  ]);
  return NextResponse.json({ requests, defaultAssigneeId });
}

// POST — ask for a payment. Anyone who may change the job may ask; recording the payment stays with the money roles.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const jobId = await jobIdOf(id);
  if (!jobId) return NextResponse.json({ error: "Labor contract not found" }, { status: 404 });
  const denied = await guardJob(session.user, jobId, "write");
  if (denied) return denied;

  const parsed = await validateBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const created = await createPaymentRequest({ contractId: id, ...parsed.data, actorUserId: session.user.id });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentRequestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
