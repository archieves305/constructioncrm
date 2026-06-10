import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const METHODS = [
  "CHECK",
  "CARD",
  "ACH",
  "CASH",
  "FINANCING",
  "WIRE",
  "OTHER",
] as const;

const createSchema = z.object({
  amount: z.number().min(0),
  paidDate: z.string().optional(),
  method: z.enum(METHODS).nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// POST /api/labor-contracts/[id]/payments — record a payment made to the crew.
// Does not affect job pricing (only the contract's outstanding balance).
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

  const payment = await prisma.laborPayment.create({
    data: {
      laborContractId: id,
      amount: parsed.data.amount,
      paidDate: parsed.data.paidDate ? new Date(parsed.data.paidDate) : new Date(),
      method: parsed.data.method ?? null,
      reference: parsed.data.reference?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      createdByUserId: session.user.id,
    },
  });

  const name = contract.crew?.name ?? contract.label ?? "Labor";
  await prisma.activityLog.create({
    data: {
      leadId: contract.job.leadId,
      activityType: "NOTE",
      title: `Labor payment to ${name}: $${parsed.data.amount.toLocaleString()}`,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(payment, { status: 201 });
}
