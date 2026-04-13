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
  const { content } = await request.json();

  if (!content?.trim()) return badRequest("Note content is required");

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const activity = await prisma.activityLog.create({
    data: {
      leadId: id,
      activityType: "NOTE",
      title: "Note added",
      description: content.trim(),
      createdByUserId: session.user.id,
    },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });

  // Update last contact
  await prisma.lead.update({
    where: { id },
    data: { lastContactAt: new Date() },
  });

  return NextResponse.json(activity, { status: 201 });
}
