import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import {
  emitInspectionEvent,
  resultEventName,
} from "@/lib/follow-ups/permit-events";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await req.json();

  const previous = await prisma.jobPermitInspection.findUnique({
    where: { id },
    select: { result: true, scheduledFor: true },
  });
  if (!previous) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.type !== undefined) updateData.type = body.type;
  if (body.scheduledFor !== undefined) {
    updateData.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
  }
  if (body.completedAt !== undefined) {
    updateData.completedAt = body.completedAt ? new Date(body.completedAt) : null;
  }
  if (body.result !== undefined) updateData.result = body.result;
  if (body.inspectorName !== undefined) updateData.inspectorName = body.inspectorName;
  if (body.notes !== undefined) updateData.notes = body.notes;

  // When a terminal result is set and the caller didn't supply completedAt,
  // stamp it now so timeline + reporting show when the inspection finished.
  if (
    body.result &&
    body.result !== "SCHEDULED" &&
    body.completedAt === undefined
  ) {
    updateData.completedAt = new Date();
  }

  const updated = await prisma.jobPermitInspection.update({
    where: { id },
    data: updateData,
    include: {
      permit: { select: { job: { select: { leadId: true } } } },
    },
  });

  // Activity-log a completed inspection so it shows up on the lead timeline.
  if (body.result && body.result !== previous.result && updated.permit?.job?.leadId) {
    await prisma.activityLog.create({
      data: {
        leadId: updated.permit.job.leadId,
        activityType:
          body.result === "PASS" ? "INSPECTION_COMPLETED" : "INSPECTION_SCHEDULED",
        title: `Inspection ${updated.type.replace(/_/g, " ")} → ${body.result}`,
        description: body.notes || undefined,
        createdByUserId: session.user.id,
      },
    });
  }

  // Fire automation on a result transition.
  if (body.result && body.result !== previous.result) {
    const event = resultEventName(body.result);
    if (event) await emitInspectionEvent(event, updated.id);
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  await prisma.jobPermitInspection.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
