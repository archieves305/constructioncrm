import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const existing = await prisma.laborPayment.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.laborPayment.delete({ where: { id } });
  await recordAudit({ actorUserId: session.user.id, entityType: "LaborPayment", entityId: id, action: "delete", before: existing });
  return NextResponse.json({ ok: true });
}
