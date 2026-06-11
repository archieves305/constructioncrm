import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const tasks = await prisma.laborContractTask.findMany({
    where: { laborContractId: id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(tasks);
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

  const contract = await prisma.laborContract.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!contract)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const count = await prisma.laborContractTask.count({
    where: { laborContractId: id },
  });

  const d = parsed.data;
  const task = await prisma.laborContractTask.create({
    data: {
      laborContractId: id,
      sortOrder: count,
      name: d.name,
      room: d.room?.trim() || null,
      description: d.description?.trim() || null,
      paymentAmount: d.paymentAmount ?? null,
      paymentPercent: d.paymentPercent ?? null,
      inspectionRequired: d.inspectionRequired ?? true,
      inspectionStatus: d.inspectionStatus ?? "PENDING",
      status: d.status ?? "NOT_STARTED",
      approvedBy: d.approvedBy?.trim() || null,
      approvedDate: d.approvedDate ? new Date(d.approvedDate) : null,
      notes: d.notes?.trim() || null,
    },
  });
  return NextResponse.json(task, { status: 201 });
}
