import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const referrals = await prisma.referral.findMany({
    include: {
      job: { select: { id: true, jobNumber: true } },
      referredBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(referrals);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  if (!body.jobId || !body.referredByLeadId || !body.referredName) {
    return badRequest("jobId, referredByLeadId, and referredName required");
  }

  const referral = await prisma.referral.create({
    data: {
      jobId: body.jobId,
      referredByLeadId: body.referredByLeadId,
      referredName: body.referredName,
      referredPhone: body.referredPhone,
      referredEmail: body.referredEmail,
      notes: body.notes,
    },
  });

  await prisma.activityLog.create({
    data: {
      leadId: body.referredByLeadId,
      activityType: "REFERRAL_CREATED",
      title: `Referral: ${body.referredName}`,
      description: body.referredPhone || undefined,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(referral, { status: 201 });
}
