import { NextRequest, NextResponse } from "next/server";
import type { BidProjectStage } from "@/generated/prisma/enums";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { createProject, listProjects } from "@/lib/bids/project";
import { createProjectSchema } from "@/lib/bids/validation";

const STAGES = ["OPEN", "PRIME_AWARDED", "POSTPONED", "REBIDDING", "CANCELLED", "CLOSED"] as const;

/** PlanHub bid projects (active by default). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const stage = sp.get("stage");
  const result = await listProjects(
    {
      stage: stage === "all" ? "all" : stage && (STAGES as readonly string[]).includes(stage) ? (stage as BidProjectStage) : "active",
      search: sp.get("search")?.trim() || undefined,
      ownerUserId: sp.get("owner") || undefined,
      tradeId: sp.get("trade") || undefined,
      organizationId: sp.get("gc") || undefined,
      county: sp.get("county")?.trim() || undefined,
      page: Math.max(1, Number(sp.get("page")) || 1),
      pageSize: Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 50)),
    },
    session.user,
  );
  return NextResponse.json({ ...result, canManage: canManagePartners(session.user.role) });
}

/** A new project; a likely duplicate answers 409 with the matches unless `force`. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, createProjectSchema);
  if (!v.ok) return v.response;
  const { force, ...input } = v.data;
  try {
    return NextResponse.json(await createProject({ ...input, state: input.state || null }, session.user.id, Boolean(force)), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
