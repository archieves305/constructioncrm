import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { recordPayment } from "@/lib/services/jobs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
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

  const { id } = await params;
  const body = await request.json();

  if (!body.paymentType || !body.amount) {
    return badRequest("paymentType and amount are required");
  }

  const payment = await recordPayment(id, body, session.user.id);
  return NextResponse.json(payment, { status: 201 });
}
