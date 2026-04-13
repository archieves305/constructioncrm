import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  const communications = await prisma.communication.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(communications);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  if (!body.communicationType || !body.body?.trim()) {
    return badRequest("communicationType and body are required");
  }

  const communication = await prisma.communication.create({
    data: {
      leadId: id,
      communicationType: body.communicationType,
      direction: body.direction || "OUTBOUND",
      fromValue: body.fromValue || "CRM User",
      toValue: body.toValue || "Lead",
      subject: body.subject,
      body: body.body.trim(),
      status: "SENT",
      sentAt: new Date(),
      createdByUserId: session.user.id,
    },
  });

  const activityType =
    body.communicationType === "CALL" ? "CALL_LOGGED" :
    body.communicationType === "SMS" ? "SMS_LOGGED" : "EMAIL_LOGGED";

  await prisma.activityLog.create({
    data: {
      leadId: id,
      activityType,
      title: `${body.communicationType} logged`,
      description: body.body.trim(),
      createdByUserId: session.user.id,
    },
  });

  await prisma.lead.update({
    where: { id },
    data: { lastContactAt: new Date() },
  });

  return NextResponse.json(communication, { status: 201 });
}
