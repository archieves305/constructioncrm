import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { nextChangeOrderNumber } from "@/lib/services/change-orders";

const createSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(8000).nullable().optional(),
  customerPrice: z.number().positive("Customer price must be greater than zero"),
  crewCost: z.number().nullable().optional(),
  laborContractId: z.string().nullable().optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const changeOrders = await prisma.changeOrder.findMany({
    where: { jobId: id },
    orderBy: { number: "desc" },
    include: {
      invoice: { select: { id: true, invoiceNumber: true, status: true } },
      laborContract: {
        select: { id: true, label: true, crew: { select: { name: true } } },
      },
    },
  });
  return NextResponse.json(changeOrders);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const v = await validateBody(request, createSchema);
  if (!v.ok) return v.response;
  const d = v.data;

  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // If a crew contract is linked, make sure it belongs to this job.
  if (d.laborContractId) {
    const lc = await prisma.laborContract.findUnique({
      where: { id: d.laborContractId },
      select: { jobId: true },
    });
    if (!lc || lc.jobId !== id)
      return NextResponse.json(
        { error: "Labor contract does not belong to this job" },
        { status: 400 },
      );
  }

  const changeOrder = await prisma.$transaction(async (tx) => {
    const number = await nextChangeOrderNumber(tx as typeof prisma, id);
    return tx.changeOrder.create({
      data: {
        jobId: id,
        number,
        title: d.title?.trim() || null,
        description: d.description?.trim() || null,
        customerPrice: d.customerPrice,
        crewCost: d.crewCost ?? null,
        laborContractId: d.laborContractId || null,
        createdByUserId: session.user.id,
      },
    });
  });

  return NextResponse.json(changeOrder, { status: 201 });
}
