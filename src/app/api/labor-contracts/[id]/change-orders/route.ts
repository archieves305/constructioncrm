import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recomputeJobLabor } from "@/lib/services/job-pricing";

const createSchema = z.object({
  // Signed: positive = additional work, negative = credit. Non-zero.
  amount: z.number().refine((n) => n !== 0, "Amount cannot be zero"),
  reason: z.string().max(2000).nullable().optional(),
  changeDate: z.string().optional(),
});

// POST /api/labor-contracts/[id]/change-orders — adjust a crew's labor contract.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const contract = await prisma.laborContract.findUnique({
    where: { id },
    include: {
      crew: { select: { name: true } },
      job: { select: { leadId: true } },
    },
  });
  if (!contract)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const changeOrder = await prisma.laborChangeOrder.create({
    data: {
      laborContractId: id,
      amount: parsed.data.amount,
      reason: parsed.data.reason?.trim() || null,
      changeDate: parsed.data.changeDate
        ? new Date(parsed.data.changeDate)
        : new Date(),
      createdByUserId: session.user.id,
    },
  });

  await recomputeJobLabor(contract.jobId);

  const name = contract.crew?.name ?? contract.label ?? "Labor";
  const sign = parsed.data.amount >= 0 ? "+" : "−";
  await prisma.activityLog.create({
    data: {
      leadId: contract.job.leadId,
      activityType: "NOTE",
      title: `Change order for ${name}: ${sign}$${Math.abs(parsed.data.amount).toLocaleString()}`,
      description: parsed.data.reason?.trim() || undefined,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(changeOrder, { status: 201 });
}
