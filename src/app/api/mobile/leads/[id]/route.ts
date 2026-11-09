import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { canWriteLeads } from "@/lib/access/roles";
import { guardLead } from "@/lib/access/records";

/**
 * GET /api/mobile/leads/[id] — one lead for the phone: who, where, stage (and
 * the stages it may move to by hand — Won is chosen at the desk, where the
 * estimate is picked), follow-up dates, the last calls / texts / emails and
 * the site photos. Writes go through the CRM's own lead routes.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canWriteLeads(session.user.role)) return forbidden();
  const { id } = await ctx.params;
  const denied = await guardLead(session.user, id, "read");
  if (denied) return denied;
  const [lead, stages, comms, photos] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      select: { id: true, kind: true, fullName: true, companyName: true, primaryPhone: true, email: true, propertyAddress1: true, city: true, state: true, zipCode: true, nextFollowUpAt: true, lastContactAt: true, currentStageId: true, currentStage: { select: { name: true, isClosed: true } }, assignedUser: { select: { firstName: true, lastName: true } }, jobs: { select: { id: true, jobNumber: true }, take: 3 } },
    }),
    prisma.leadStage.findMany({ where: { isWon: false }, orderBy: { stageOrder: "asc" }, select: { id: true, name: true, isLost: true } }),
    prisma.communication.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, communicationType: true, direction: true, body: true, createdAt: true, createdBy: { select: { firstName: true, lastName: true } } } }),
    prisma.file.findMany({ where: { leadId: id, jobId: null, category: "PHOTOS" }, orderBy: { createdAt: "desc" }, take: 24, select: { id: true } }),
  ]);
  if (!lead || lead.kind !== "CUSTOMER") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    {
      id: lead.id,
      name: lead.companyName || lead.fullName,
      phone: lead.primaryPhone || null,
      email: lead.email,
      street: lead.propertyAddress1,
      cityLine: [lead.city, [lead.state, lead.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      stageId: lead.currentStageId,
      stage: lead.currentStage.name,
      closed: lead.currentStage.isClosed,
      owner: lead.assignedUser ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`.trim() : null,
      nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
      lastContactAt: lead.lastContactAt?.toISOString() ?? null,
      jobs: lead.jobs,
      stages,
      contacts: comms.map((c) => ({ id: c.id, type: c.communicationType, direction: c.direction, body: c.body.slice(0, 400), at: c.createdAt.toISOString(), by: c.createdBy ? `${c.createdBy.firstName} ${c.createdBy.lastName}`.trim() : null })),
      photoIds: photos.map((p) => p.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
