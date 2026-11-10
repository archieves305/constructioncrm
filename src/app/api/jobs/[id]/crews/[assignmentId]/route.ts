import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { notifyCrewOfInstall, syncInstallTask } from "@/lib/crews/install-run";
import { dayOfDate } from "@/lib/permits/alerts";
import { parseDueAt } from "@/lib/tasks/dates";
import { validateBody } from "@/lib/validation/body";
import { settleJobGates } from "@/lib/workflows/gates";

type Params = { params: Promise<{ id: string; assignmentId: string }> };

const patchSchema = z
  .object({
    installDate: z.string().nullable().optional(),
    /** When the crew starts that day, minutes after midnight; null clears it. */
    startMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  })
  .refine((d) => d.installDate !== undefined || d.startMinutes !== undefined, { message: "Nothing to change" });

const notFound = () => NextResponse.json({ error: "Crew assignment not found" }, { status: 404 });

const longDay = (d: Date) =>
  new Date(`${dayOfDate(d)}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Set, move or clear a crew's install date and start time. A moved date asks the crew again. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id, assignmentId } = await params;
  const denied = await guardJob(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, patchSchema);
  if (!body.ok) return body.response;

  const dateGiven = body.data.installDate !== undefined;
  const parsedDate = body.data.installDate ? parseDueAt(body.data.installDate) : null;
  if (parsedDate && Number.isNaN(parsedDate.getTime())) return badRequest("installDate must be a date");

  const before = await prisma.crewAssignment.findFirst({
    where: { id: assignmentId, jobId: id },
    select: { installDate: true, crew: { select: { name: true } }, job: { select: { leadId: true } } },
  });
  if (!before) return notFound();
  const installDate = dateGiven ? parsedDate : before.installDate;
  const moved = dateGiven && (before.installDate ? dayOfDate(before.installDate) : null) !== (installDate ? dayOfDate(installDate) : null);

  const assignment = await prisma.crewAssignment.update({
    where: { id: assignmentId },
    data: {
      ...(dateGiven ? { installDate } : {}),
      ...(body.data.startMinutes !== undefined ? { startMinutes: body.data.startMinutes } : {}),
      // A different day needs a new answer from the crew.
      ...(moved ? { confirmation: null, confirmationAt: null, confirmedByUserId: null } : {}),
    },
    include: { crew: true },
  });

  const was = before.installDate ? dayOfDate(before.installDate) : null;
  const now = installDate ? dayOfDate(installDate) : null;
  if (was !== now) {
    await prisma.activityLog.create({
      data: {
        leadId: before.job.leadId,
        activityType: "CREW_ASSIGNED",
        title: installDate
          ? `Install date ${before.installDate ? "moved to" : "set for"} ${longDay(installDate)}: ${before.crew.name}`
          : `Install date cleared: ${before.crew.name}`,
        createdByUserId: session.user.id,
      },
    });
  }

  const installTask = await syncInstallTask(assignmentId, session.user.id);
  if (installDate && moved) await settleJobGates(id, session.user.id);
  if (installDate && (moved || body.data.startMinutes !== undefined)) await notifyCrewOfInstall(assignmentId, session.user.id);

  return NextResponse.json({ ...assignment, installTask });
}

/** Take a crew off the job. Its get-ready task closes with the reason. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id, assignmentId } = await params;
  const denied = await guardJob(session.user, id, "write");
  if (denied) return denied;

  const before = await prisma.crewAssignment.findFirst({
    where: { id: assignmentId, jobId: id },
    select: { crew: { select: { name: true } }, job: { select: { leadId: true } } },
  });
  if (!before) return notFound();

  await prisma.crewAssignment.delete({ where: { id: assignmentId } });
  await prisma.activityLog.create({
    data: {
      leadId: before.job.leadId,
      activityType: "CREW_ASSIGNED",
      title: `Crew removed: ${before.crew.name}`,
      createdByUserId: session.user.id,
    },
  });
  await syncInstallTask(assignmentId, session.user.id);

  return NextResponse.json({ ok: true });
}
