import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManageJobMoney } from "@/lib/money/access";
import { cancelPaymentRequest, PaymentRequestError } from "@/lib/labor/payment-requests";

// DELETE — withdraw a payment request. Whoever raised it, or a money role.
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const r = await prisma.laborPaymentRequest.findUnique({ where: { id }, select: { requestedByUserId: true } });
  if (!r) return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
  if (r.requestedByUserId !== session.user.id && !canManageJobMoney(session.user.role)) return forbidden();

  try {
    await cancelPaymentRequest(id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PaymentRequestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
