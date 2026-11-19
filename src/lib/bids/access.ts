import { NextResponse } from "next/server";
import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { leadAccessWhere } from "@/lib/access/records";

/**
 * PlanHub bid projects ride on the Business Development roles
 * (`@/lib/partners/access`): view = PARTNER_VIEW_ROLES, change =
 * PARTNER_MANAGE_ROLES, a confirmed award (it creates a job) =
 * PARTNER_ADMIN_ROLES. An own-only role (SALES_REP) reaches a project it owns
 * or one where it can open a GC's lead — the same rule as the list, so the
 * list never links to a 404.
 */
export async function guardProject(viewer: { id: string; role: RoleName }, projectId: string): Promise<NextResponse | null> {
  const scoped = leadAccessWhere(viewer);
  const where = Object.keys(scoped).length ? { id: projectId, OR: [{ ownerUserId: viewer.id }, { opportunities: { some: { lead: scoped } } }] } : { id: projectId };
  const hit = await prisma.bidProject.findFirst({ where, select: { id: true } });
  return hit ? null : NextResponse.json({ error: "Project not found" }, { status: 404 });
}

/** The scope row's GC opportunity, for the bid guard. */
export async function bidIdOfScope(oppScopeId: string): Promise<string | null> {
  const r = await prisma.bidOpportunityScope.findUnique({ where: { id: oppScopeId }, select: { bidInvitationId: true } });
  return r?.bidInvitationId ?? null;
}

export async function bidIdOfAward(awardId: string): Promise<string | null> {
  const r = await prisma.bidAward.findUnique({ where: { id: awardId }, select: { bidInvitationId: true } });
  return r?.bidInvitationId ?? null;
}
