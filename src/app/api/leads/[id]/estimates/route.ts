import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardLead(session.user, id, "read");
  if (denied) return denied;

  const estimates = await prisma.roofEstimate.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(estimates);
}

/**
 * Roof estimates are kept as history (audit roadmap MVP 5, ruled 2026-10-19):
 * new roofing work is a sectioned estimate with a section built from a roof
 * measurement. Existing ones are still read, printed and picked at Won.
 */
export async function POST() {
  return NextResponse.json({ error: "Roof estimates are kept as history. Start a new estimate (Roofing) and add a section from the roof measurement." }, { status: 410 });
}

