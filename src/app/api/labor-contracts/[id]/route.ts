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
  paymentTerms: z.string().max(4000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  estimatedCompletionDate: z.string().nullable().optional(),
  contractorLicense: z.string().max(120).nullable().optional(),
  contractorInsurance: z.string().max(2000).nullable().optional(),
  exclusions: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  retainagePercent: z.number().min(0).max(100).nullable().optional(),
  delayDamagesPerDay: z.number().min(0).nullable().optional(),
});

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  if (parsed.data.paymentTerms !== undefined)
    data.paymentTerms = parsed.data.paymentTerms?.trim() || null;
  if (parsed.data.startDate !== undefined)
    data.startDate = parseDate(parsed.data.startDate);
  if (parsed.data.estimatedCompletionDate !== undefined)
    data.estimatedCompletionDate = parseDate(
      parsed.data.estimatedCompletionDate,
    );
  if (parsed.data.contractorLicense !== undefined)
    data.contractorLicense = parsed.data.contractorLicense?.trim() || null;
  if (parsed.data.contractorInsurance !== undefined)
    data.contractorInsurance = parsed.data.contractorInsurance?.trim() || null;
  if (parsed.data.exclusions !== undefined)
    data.exclusions = parsed.data.exclusions?.trim() || null;
  if (parsed.data.notes !== undefined)
    data.notes = parsed.data.notes?.trim() || null;
  if (parsed.data.retainagePercent !== undefined)
    data.retainagePercent = parsed.data.retainagePercent;
  if (parsed.data.delayDamagesPerDay !== undefined)
    data.delayDamagesPerDay = parsed.data.delayDamagesPerDay;
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
