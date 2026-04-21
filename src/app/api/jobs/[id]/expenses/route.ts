import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recomputeCostPlusJob } from "@/lib/services/job-pricing";

const TYPES = [
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "PERMIT_FEE",
  "SUBCONTRACTOR",
  "CHANGE_ORDER",
  "OTHER",
] as const;

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
  type: z.enum(TYPES).default("OTHER"),
  vendor: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  amount: z.number().min(0),
  incurredDate: z.string().optional(),
  paidMethod: z.enum(METHODS).nullable().optional(),
  paidFrom: z.string().max(120).nullable().optional(),
  billable: z.boolean().default(false),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const expenses = await prisma.jobExpense.findMany({
    where: { jobId: id },
    orderBy: { incurredDate: "desc" },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(expenses);
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
    select: { leadId: true, jobType: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const amount = parsed.data.amount;
  const isCostPlus = job.jobType === "COST_PLUS";
  // On cost-plus, billable is irrelevant — every expense rolls into the contract via recompute
  const billable = isCostPlus ? false : parsed.data.billable;

  const [expense] = await prisma.$transaction([
    prisma.jobExpense.create({
      data: {
        jobId: id,
        type: parsed.data.type,
        vendor: parsed.data.vendor?.trim() || null,
        description: parsed.data.description?.trim() || null,
        amount,
        incurredDate: parsed.data.incurredDate
          ? new Date(parsed.data.incurredDate)
          : new Date(),
        paidMethod: parsed.data.paidMethod ?? null,
        paidFrom: parsed.data.paidFrom?.trim() || null,
        billable,
        createdByUserId: session.user.id,
      },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
      },
    }),
    ...(billable
      ? [
          prisma.job.update({
            where: { id },
            data: {
              contractAmount: { increment: amount },
              balanceDue: { increment: amount },
            },
          }),
        ]
      : []),
  ]);

  if (isCostPlus) await recomputeCostPlusJob(id);

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "NOTE",
      title: `Expense added: ${parsed.data.type.replace(/_/g, " ")} — $${amount.toLocaleString()}`,
      description: isCostPlus
        ? `Cost-plus; rolled into contract${parsed.data.vendor ? ` · ${parsed.data.vendor}` : ""}`
        : billable
          ? `Billable; added to contract${parsed.data.vendor ? ` · ${parsed.data.vendor}` : ""}`
          : parsed.data.vendor || undefined,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(expense, { status: 201 });
}
