import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recordPayment } from "@/lib/services/jobs";
import { recordAudit } from "@/lib/audit/record";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { guardJob } from "@/lib/access/records";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;
  const payments = await prisma.payment.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(payments);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await params;
  const body = await request.json();

  const amount = Number(body.amount);
  if (!["DEPOSIT", "PROGRESS", "FINAL", "FINANCING_FUNDING"].includes(body.paymentType)) {
    return badRequest("paymentType must be DEPOSIT, PROGRESS, FINAL or FINANCING_FUNDING");
  }
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("amount must be a positive number");

  const payment = await recordPayment(id, { ...body, amount }, session.user.id);
  await recordAudit({ actorUserId: session.user.id, entityType: "Payment", entityId: payment.id, action: "create", after: payment });
  return NextResponse.json(payment, { status: 201 });
}
