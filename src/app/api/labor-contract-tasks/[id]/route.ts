import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  room: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  paymentAmount: z.number().min(0).nullable().optional(),
  paymentPercent: z.number().min(0).max(100).nullable().optional(),
  inspectionRequired: z.boolean().optional(),
  inspectionStatus: z.enum(["PENDING", "PASSED", "FAILED", "NA"]).optional(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE"]).optional(),
  approvedBy: z.string().max(200).nullable().optional(),
  approvedDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
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

  const existing = await prisma.laborContractTask.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.name !== undefined) data.name = d.name;
  if (d.room !== undefined) data.room = d.room?.trim() || null;
  if (d.description !== undefined)
    data.description = d.description?.trim() || null;
  if (d.paymentAmount !== undefined) data.paymentAmount = d.paymentAmount;
  if (d.paymentPercent !== undefined) data.paymentPercent = d.paymentPercent;
  if (d.inspectionRequired !== undefined)
    data.inspectionRequired = d.inspectionRequired;
  if (d.inspectionStatus !== undefined)
    data.inspectionStatus = d.inspectionStatus;
  if (d.status !== undefined) data.status = d.status;
  if (d.approvedBy !== undefined) data.approvedBy = d.approvedBy?.trim() || null;
  if (d.approvedDate !== undefined)
    data.approvedDate = d.approvedDate ? new Date(d.approvedDate) : null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const task = await prisma.laborContractTask.update({ where: { id }, data });
  return NextResponse.json(task);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.laborContractTask.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.laborContractTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
