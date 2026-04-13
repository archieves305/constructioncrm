import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  if (!body.crewId) return badRequest("crewId is required");

  const assignment = await prisma.crewAssignment.create({
    data: {
      jobId: id,
      crewId: body.crewId,
      installDate: body.installDate ? new Date(body.installDate) : null,
    },
    include: { crew: true },
  });

  const job = await prisma.job.findUnique({ where: { id }, select: { leadId: true } });
  if (job) {
    await prisma.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "CREW_ASSIGNED",
        title: `Crew assigned: ${assignment.crew.name}`,
        createdByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json(assignment, { status: 201 });
}
