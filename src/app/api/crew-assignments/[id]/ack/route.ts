import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { guardJob } from "@/lib/access/records";
import { withIdempotency } from "@/lib/api/idempotency";
import { validateBody } from "@/lib/validation/body";
import { crewAckRequest } from "@/lib/mobile-api/crew";
import { createTask } from "@/lib/tasks/create";
import { formatAddressLine } from "@/lib/labels/address";
import { dayOfDate } from "@/lib/permits/alerts";

/**
 * POST /api/crew-assignments/[id]/ack — a crew lead answers an install day
 * from the phone: Got it, or Can't make it. Only the office changes the date;
 * this records the answer (as a guest link's INSTALL_CONFIRM does) and, for
 * Can't make it, gives the PM a task due today. Anyone on the job but
 * READ_ONLY may answer; the job's own guard decides who is on it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const viewer = session.user;
  if (viewer.role === "READ_ONLY") return forbidden("Your role can't answer for a crew.");
  const { id } = await params;

  const a = await prisma.crewAssignment.findUnique({
    where: { id },
    select: { id: true, jobId: true, installDate: true, crew: { select: { name: true } }, job: { select: { projectManagerId: true, lead: { select: { propertyAddress1: true, city: true } } } } },
  });
  if (!a) return NextResponse.json({ error: "Crew assignment not found" }, { status: 404 });
  const denied = await guardJob(viewer, a.jobId, "read");
  if (denied) return denied;

  return withIdempotency(request, viewer.id, `POST /api/crew-assignments/${id}/ack`, async () => {
    const body = await validateBody(request, crewAckRequest);
    if (!body.ok) return body.response;
    const { answer, note } = body.data;

    const saved = await prisma.crewAssignment.update({
      where: { id },
      data: { confirmation: answer, confirmationAt: new Date(), confirmedByUserId: viewer.id },
      select: { id: true, confirmation: true, confirmationAt: true },
    });

    if (answer === "CANT_MAKE_IT") {
      const where = formatAddressLine(a.job.lead) || "the job";
      const day = a.installDate ? ` on ${dayOfDate(a.installDate)}` : "";
      await createTask(
        {
          jobId: a.jobId,
          title: `${viewer.firstName} can't make the ${a.crew?.name ? `${a.crew.name} ` : ""}install day${day} · ${where}`,
          description: note ? `Note from the field: ${note}` : null,
          priority: "HIGH",
          assignedUserId: a.job.projectManagerId ?? viewer.id,
          createdByUserId: viewer.id,
          dueAt: new Date(),
          source: "crew_app",
        },
        { actorUserId: viewer.id },
      );
    }

    return NextResponse.json({ id: saved.id, confirmation: saved.confirmation, confirmationAt: (saved.confirmationAt as Date).toISOString() });
  });
}
