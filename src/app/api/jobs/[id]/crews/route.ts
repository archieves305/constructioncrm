import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { syncInstallTask } from "@/lib/crews/install-run";
import { parseDueAt } from "@/lib/tasks/dates";
import { validateBody } from "@/lib/validation/body";
import { settleJobGates } from "@/lib/workflows/gates";

const assignSchema = z.object({
  crewId: z.string().min(1, "crewId is required"),
  installDate: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, assignSchema);
  if (!body.ok) return body.response;

  const installDate = body.data.installDate ? parseDueAt(body.data.installDate) : null;
  if (installDate && Number.isNaN(installDate.getTime())) return badRequest("installDate must be a date");
  const crew = await prisma.crew.findUnique({ where: { id: body.data.crewId }, select: { id: true } });
  if (!crew) return badRequest("That crew does not exist");

  const assignment = await prisma.crewAssignment.create({
    data: { jobId: id, crewId: body.data.crewId, installDate },
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

  // The install date's get-ready task, and the checklist line that restates it.
  const installTask = await syncInstallTask(assignment.id, session.user.id);
  if (installDate) await settleJobGates(id, session.user.id);

  return NextResponse.json({ ...assignment, installTask }, { status: 201 });
}
