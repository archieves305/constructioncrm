import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { assignedUserId, reason } = await request.json();

  if (!assignedUserId) return badRequest("assignedUserId is required");

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { assignedUserId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Close previous assignment
  if (lead.assignedUserId) {
    await prisma.leadAssignment.updateMany({
      where: { leadId: id, unassignedAt: null },
      data: { unassignedAt: new Date() },
    });
  }

  // Create new assignment
  await prisma.leadAssignment.create({
    data: {
      leadId: id,
      assignedUserId,
      assignedByUserId: session.user.id,
      reason,
    },
  });

  const updated = await prisma.lead.update({
    where: { id },
    data: { assignedUserId },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await prisma.activityLog.create({
    data: {
      leadId: id,
      activityType: "ASSIGNMENT_CHANGE",
      title: `Assigned to ${updated.assignedUser?.firstName} ${updated.assignedUser?.lastName}`,
      description: reason || undefined,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(updated);
}
