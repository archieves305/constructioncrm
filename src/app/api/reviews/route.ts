import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || undefined;

  const reviews = await prisma.reviewRequest.findMany({
    where: status ? { status: status as "PENDING" | "SENT" | "COMPLETED" | "DECLINED" } : undefined,
    include: {
      job: { select: { id: true, jobNumber: true, title: true } },
      lead: { select: { id: true, fullName: true, primaryPhone: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(reviews);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const body = await request.json();
  if (!body.jobId || !body.leadId) return badRequest("jobId and leadId required");

  const review = await prisma.reviewRequest.create({
    data: {
      jobId: body.jobId,
      leadId: body.leadId,
      platform: body.platform || "Google",
      status: "PENDING",
    },
  });

  await prisma.activityLog.create({
    data: {
      leadId: body.leadId,
      activityType: "REVIEW_REQUESTED",
      title: `Review requested on ${body.platform || "Google"}`,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(review, { status: 201 });
}
