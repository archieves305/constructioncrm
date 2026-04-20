import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { toQboCsv, type QboExpenseRow } from "@/lib/qbo/export";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      jobNumber: true,
      lead: {
        select: {
          fullName: true,
          propertyAddress1: true,
          city: true,
        },
      },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const expenses = await prisma.jobExpense.findMany({
    where: { jobId: id },
    orderBy: { incurredDate: "asc" },
  });

  const rows: QboExpenseRow[] = expenses.map((e) => ({
    expenseId: e.id,
    incurredDate: e.incurredDate,
    amount: Number(e.amount),
    type: e.type,
    vendor: e.vendor,
    description: e.description,
    paidMethod: e.paidMethod,
    paidFrom: e.paidFrom,
    jobNumber: job.jobNumber,
    customerName: job.lead.fullName,
    propertyAddress: [job.lead.propertyAddress1, job.lead.city]
      .filter(Boolean)
      .join(", "),
  }));

  const csv = toQboCsv(rows);

  return new NextResponse("\ufeff" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="qbo-expenses-${job.jobNumber}.csv"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
