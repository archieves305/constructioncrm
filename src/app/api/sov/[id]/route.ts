import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { canManageProgressBilling } from "@/lib/services/progress-billing";

const updateSchema = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  scheduledValue: z.number().min(0).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageProgressBilling(session.user.role)) return forbidden();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const existing = await prisma.sovLine.findUnique({
    where: { id },
    select: { changeOrderId: true, changeOrder: { select: { number: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (parsed.data.scheduledValue !== undefined && existing.changeOrderId) {
    // The value IS the change order's price; change the change order instead.
    return badRequest(
      `This line is change order CO-${existing.changeOrder?.number}; its scheduled value follows the change order`,
    );
  }

  if (parsed.data.scheduledValue !== undefined) {
    // A line can't be scheduled below what has already been billed on it.
    const billed = await prisma.invoiceLine.aggregate({
      where: { sovLineId: id, invoice: { status: { not: "VOID" } } },
      _sum: { workCompleted: true },
    });
    const soFar = Number(billed._sum.workCompleted ?? 0);
    if (parsed.data.scheduledValue + 0.005 < soFar)
      return badRequest(
        `$${soFar.toLocaleString()} has already been billed on this line`,
      );
  }

  const line = await prisma.sovLine
    .update({ where: { id }, data: parsed.data })
    .catch(() => null);
  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(line);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageProgressBilling(session.user.role)) return forbidden();

  const { id } = await context.params;
  const linked = await prisma.sovLine.findUnique({
    where: { id },
    select: { changeOrder: { select: { number: true } } },
  });
  if (linked?.changeOrder)
    return NextResponse.json(
      { error: `This line was added by change order CO-${linked.changeOrder.number}. Delete the change order to remove it.` },
      { status: 409 },
    );
  const used = await prisma.invoiceLine.count({ where: { sovLineId: id } });
  if (used > 0)
    return NextResponse.json(
      { error: "This line has been billed on an application and can't be removed" },
      { status: 409 },
    );
  const deleted = await prisma.sovLine
    .delete({ where: { id } })
    .catch(() => null);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
