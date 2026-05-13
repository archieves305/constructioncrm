import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { emitInspectionEvent } from "@/lib/follow-ups/permit-events";

const INSPECTION_TYPES = [
  "ROUGH",
  "FRAMING",
  "ELECTRICAL",
  "PLUMBING",
  "MECHANICAL",
  "ROOFING_IN_PROGRESS",
  "ROOFING_FINAL",
  "FINAL",
  "OTHER",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const inspections = await prisma.jobPermitInspection.findMany({
    where: { permitId: id },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(inspections);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await req.json();

  const type = body.type && INSPECTION_TYPES.includes(body.type) ? body.type : "OTHER";

  const created = await prisma.jobPermitInspection.create({
    data: {
      permitId: id,
      type,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      completedAt: body.completedAt ? new Date(body.completedAt) : null,
      result: body.result ?? "SCHEDULED",
      inspectorName: body.inspectorName ?? null,
      notes: body.notes ?? null,
    },
  });

  // Activity log on the lead, mirroring the permit-create pattern.
  const permit = await prisma.jobPermit.findUnique({
    where: { id },
    select: { job: { select: { leadId: true } } },
  });
  if (permit?.job?.leadId) {
    await prisma.activityLog.create({
      data: {
        leadId: permit.job.leadId,
        activityType: "INSPECTION_SCHEDULED",
        title: `Inspection scheduled: ${type.replace(/_/g, " ")}`,
        description: created.scheduledFor
          ? `Scheduled for ${created.scheduledFor.toISOString().slice(0, 10)}`
          : undefined,
        createdByUserId: session.user.id,
      },
    });
  }

  // Only fire INSPECTION_SCHEDULED when there's a future date attached —
  // otherwise rules like "T-24h reminder" have nothing to anchor to.
  if (created.scheduledFor && created.result === "SCHEDULED") {
    await emitInspectionEvent("INSPECTION_SCHEDULED", created.id);
  }

  return NextResponse.json(created, { status: 201 });
}
