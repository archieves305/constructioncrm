import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recomputeJobLabor } from "@/lib/services/job-pricing";

const createSchema = z
  .object({
    crewId: z.string().nullable().optional(),
    label: z.string().max(120).nullable().optional(),
    contractAmount: z.number().min(0),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => Boolean(d.crewId) || Boolean(d.label?.trim()), {
    message: "Select a crew or enter a name",
  });

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const contracts = await prisma.laborContract.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "asc" },
    include: {
      crew: { select: { id: true, name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      payments: { orderBy: { paidDate: "desc" } },
    },
  });
  return NextResponse.json(contracts);
}

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

  const job = await prisma.job.findUnique({
    where: { id },
    select: { leadId: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // When a real crew is chosen, the crew name is the display name; clear label.
  const crewId = parsed.data.crewId || null;
  const label = crewId ? null : parsed.data.label?.trim() || null;

  const contract = await prisma.laborContract.create({
    data: {
      jobId: id,
      crewId,
      label,
      contractAmount: parsed.data.contractAmount,
      description: parsed.data.description?.trim() || null,
      createdByUserId: session.user.id,
    },
    include: {
      crew: { select: { id: true, name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      payments: true,
    },
  });

  await recomputeJobLabor(id);

  const name = contract.crew?.name ?? contract.label ?? "Labor";
  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "NOTE",
      title: `Labor contract added: ${name} — $${parsed.data.contractAmount.toLocaleString()}`,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(contract, { status: 201 });
}
