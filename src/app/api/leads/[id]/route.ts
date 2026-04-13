import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { updateLeadSchema } from "@/lib/validators/lead";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      currentStage: true,
      source: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      services: { include: { serviceCategory: true } },
      stageHistory: {
        include: {
          fromStage: true,
          toStage: true,
          changedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { changedAt: "desc" },
      },
      assignments: {
        include: {
          assignedTo: { select: { firstName: true, lastName: true } },
          assignedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { assignedAt: "desc" },
      },
      tasks: {
        include: {
          assignedTo: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      activityLogs: {
        include: {
          createdBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      communications: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      permits: {
        orderBy: { createdAt: "desc" },
      },
      files: {
        include: {
          uploadedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json(lead);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(JSON.stringify(parsed.error.issues));
  }

  const input = parsed.data;
  const { serviceCategoryIds, ...updateData } = input;

  // Update fullName if name fields changed
  const fullNameUpdate: Record<string, string> = {};
  if (input.firstName || input.lastName) {
    const existing = await prisma.lead.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
    if (existing) {
      fullNameUpdate.fullName = `${input.firstName || existing.firstName} ${input.lastName || existing.lastName}`;
    }
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      ...updateData,
      ...fullNameUpdate,
      email: updateData.email || null,
      nextFollowUpAt: updateData.nextFollowUpAt ? new Date(updateData.nextFollowUpAt) : undefined,
    },
    include: {
      currentStage: true,
      source: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      services: { include: { serviceCategory: true } },
    },
  });

  // Update services if provided
  if (serviceCategoryIds) {
    await prisma.leadService.deleteMany({ where: { leadId: id } });
    if (serviceCategoryIds.length > 0) {
      await prisma.leadService.createMany({
        data: serviceCategoryIds.map((scId) => ({
          leadId: id,
          serviceCategoryId: scId,
        })),
      });
    }
  }

  await prisma.activityLog.create({
    data: {
      leadId: id,
      activityType: "LEAD_UPDATED",
      title: "Lead updated",
      description: `Lead was updated`,
      createdByUserId: session.user.id,
    },
  });

  return NextResponse.json(lead);
}
