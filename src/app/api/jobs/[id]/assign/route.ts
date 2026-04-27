import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";

const schema = z.object({
  salesRepId: z.string().min(1).nullable().optional(),
  projectManagerId: z.string().min(1).nullable().optional(),
});

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
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const { salesRepId, projectManagerId } = v.data;

  if (salesRepId === undefined && projectManagerId === undefined) {
    return NextResponse.json(
      { error: "Provide salesRepId or projectManagerId" },
      { status: 400 },
    );
  }

  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, leadId: true, salesRepId: true, projectManagerId: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const userIds = [salesRepId, projectManagerId].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });
    if (users.length !== new Set(userIds).size) {
      return NextResponse.json({ error: "Assignee not found or inactive" }, { status: 400 });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (salesRepId !== undefined) updateData.salesRepId = salesRepId;
  if (projectManagerId !== undefined) updateData.projectManagerId = projectManagerId;

  const updated = await prisma.job.update({
    where: { id },
    data: updateData,
    include: {
      currentStage: true,
      lead: { select: { id: true, fullName: true, primaryPhone: true, propertyAddress1: true, city: true } },
      salesRep: { select: { id: true, firstName: true, lastName: true } },
      projectManager: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const titleParts: string[] = [];
  if (salesRepId !== undefined) {
    titleParts.push(
      updated.salesRep
        ? `sales rep → ${updated.salesRep.firstName} ${updated.salesRep.lastName}`
        : "sales rep cleared",
    );
  }
  if (projectManagerId !== undefined) {
    titleParts.push(
      updated.projectManager
        ? `PM → ${updated.projectManager.firstName} ${updated.projectManager.lastName}`
        : "PM cleared",
    );
  }

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "ASSIGNMENT_CHANGE",
      title: `Job ${titleParts.join(", ")}`,
      createdByUserId: session.user.id,
    },
  });

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "Job",
    entityId: id,
    action: "assign",
    before: { salesRepId: job.salesRepId, projectManagerId: job.projectManagerId },
    after: {
      salesRepId: updated.salesRepId,
      projectManagerId: updated.projectManagerId,
    },
  });

  return NextResponse.json(updated);
}
