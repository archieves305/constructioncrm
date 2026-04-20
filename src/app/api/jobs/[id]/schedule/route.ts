import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("invalid body");

  const scheduledDate = body.scheduledDate
    ? new Date(body.scheduledDate)
    : body.scheduledDate === null
      ? null
      : undefined;
  const crewId: string | null | undefined = body.crewId;

  const job = await prisma.job.findUnique({
    where: { id },
    select: { leadId: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ops: Promise<unknown>[] = [];

  if (scheduledDate !== undefined) {
    ops.push(
      prisma.job.update({
        where: { id },
        data: { scheduledDate },
      }),
    );
  }

  if (crewId !== undefined) {
    ops.push(prisma.crewAssignment.deleteMany({ where: { jobId: id } }));
    if (crewId) {
      ops.push(
        prisma.crewAssignment.create({
          data: {
            jobId: id,
            crewId,
            installDate: scheduledDate ?? null,
          },
        }),
      );
    }
  }

  await Promise.all(ops);

  const updated = await prisma.job.findUnique({
    where: { id },
    include: { crewAssignments: { include: { crew: true } } },
  });

  if (crewId) {
    const crew = await prisma.crew.findUnique({ where: { id: crewId }, select: { name: true } });
    await prisma.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "CREW_ASSIGNED",
        title: `${crew?.name || "Crew"} scheduled${
          scheduledDate ? ` for ${scheduledDate.toISOString().slice(0, 10)}` : ""
        }`,
        createdByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json(updated);
}
