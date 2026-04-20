import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const createSchema = z.object({
  amount: z.number().min(0).optional(),
  dueDate: z.string().optional(),
  notes: z.string().max(5000).optional(),
  status: z.enum(["DRAFT", "SENT"]).optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const invoices = await prisma.invoice.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(invoices);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const job = await prisma.job.findUnique({
    where: { id },
    select: { leadId: true, balanceDue: true, jobNumber: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const amount = parsed.data.amount ?? Number(job.balanceDue);
  const count = await prisma.invoice.count({ where: { jobId: id } });
  const invoiceNumber = `${job.jobNumber.replace("JOB-", "INV-")}-${String(count + 1).padStart(2, "0")}`;

  const invoice = await prisma.invoice.create({
    data: {
      jobId: id,
      invoiceNumber,
      amount,
      status: parsed.data.status ?? "DRAFT",
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      notes: parsed.data.notes,
    },
  });

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "NOTE",
      title: `Invoice ${invoice.invoiceNumber} created`,
      description: `$${amount.toLocaleString()}`,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(invoice, { status: 201 });
}
