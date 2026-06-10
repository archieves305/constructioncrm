import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const schema = z.object({
  allocations: z
    .array(
      z.object({
        budgetLineId: z.string().min(1),
        amount: z.number().positive(),
      }),
    )
    .max(50),
});

// PUT /api/expenses/[id]/budget-allocations — replace this expense's budget
// allocations. Σ amounts must be ≤ the expense amount; lines must be on the job.
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const expense = await prisma.jobExpense.findUnique({
    where: { id },
    select: { id: true, jobId: true, amount: true },
  });
  if (!expense)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allocs = parsed.data.allocations;
  const total = allocs.reduce((s, a) => s + a.amount, 0);
  if (total > Number(expense.amount) + 0.005)
    return badRequest("Allocations exceed the expense amount");

  if (allocs.length > 0) {
    const lineIds = [...new Set(allocs.map((a) => a.budgetLineId))];
    const valid = await prisma.budgetLine.count({
      where: { id: { in: lineIds }, jobId: expense.jobId },
    });
    if (valid !== lineIds.length)
      return badRequest("A budget line does not belong to this job");
  }

  await prisma.$transaction([
    prisma.budgetAllocation.deleteMany({ where: { expenseId: id } }),
    ...(allocs.length > 0
      ? [
          prisma.budgetAllocation.createMany({
            data: allocs.map((a) => ({
              expenseId: id,
              budgetLineId: a.budgetLineId,
              amount: a.amount,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
