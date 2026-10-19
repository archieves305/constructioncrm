import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { assignLead, canAssignLeads } from "@/lib/leads/assign";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (!canAssignLeads(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { assignedUserId, reason } = await request.json();

  if (!assignedUserId) return badRequest("assignedUserId is required");

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const updated = await assignLead(id, assignedUserId, session.user.id, reason);

  return NextResponse.json(updated);
}
