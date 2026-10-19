import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;
  const denied = await guardLead(session.user, id, "read");
  if (denied) return denied;

  const estimate = await prisma.roofEstimate.findFirst({
    where: { id: estimateId, leadId: id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!estimate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(estimate);
}

/**
 * Roof estimates are kept as history (audit roadmap MVP 5, ruled 2026-10-19):
 * new roofing work is a sectioned estimate with a section built from a roof
 * measurement. Existing ones are still read, printed and picked at Won.
 */
export async function PUT() {
  return NextResponse.json({ error: "Roof estimates are kept as history. Start a new estimate (Roofing) and add a section from the roof measurement." }, { status: 410 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;
  const denied = await guardLead(session.user, id, "write");
  if (denied) return denied;

  const existing = await prisma.roofEstimate.findFirst({
    where: { id: estimateId, leadId: id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.roofEstimate.delete({ where: { id: estimateId } });
  return NextResponse.json({ ok: true });
}
