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
