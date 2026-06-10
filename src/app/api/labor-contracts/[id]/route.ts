import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recomputeJobLabor } from "@/lib/services/job-pricing";

const updateSchema = z.object({
  crewId: z.string().nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  contractAmount: z.number().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const existing = await prisma.laborContract.findUnique({
    where: { id },
    select: { id: true, jobId: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.contractAmount !== undefined)
    data.contractAmount = parsed.data.contractAmount;
  if (parsed.data.description !== undefined)
    data.description = parsed.data.description?.trim() || null;
  // crewId/label are paired — a real crew clears the ad-hoc label.
  if (parsed.data.crewId !== undefined || parsed.data.label !== undefined) {
    const crewId = parsed.data.crewId || null;
    data.crewId = crewId;
    data.label = crewId ? null : parsed.data.label?.trim() || null;
  }

  await prisma.laborContract.update({ where: { id }, data });
  await recomputeJobLabor(existing.jobId);

  const record = await prisma.laborContract.findUnique({
    where: { id },
    include: {
      crew: { select: { id: true, name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      payments: { orderBy: { paidDate: "desc" } },
    },
  });
  return NextResponse.json(record);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.laborContract.findUnique({
    where: { id },
    select: { jobId: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.laborContract.delete({ where: { id } });
  await recomputeJobLabor(existing.jobId);

  return NextResponse.json({ ok: true });
}
