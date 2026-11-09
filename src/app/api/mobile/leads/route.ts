import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { canWriteLeads } from "@/lib/access/roles";
import { buildLeadListWhere, parseLeadListParams } from "@/lib/leads/query";

/**
 * GET /api/mobile/leads?list=call|mine&q= — homeowner leads for the phone.
 * The same builder as the Leads page (the sales-rep floor included): `call`
 * is the page's call list (follow-up due by tonight, or never contacted, most
 * overdue first); `mine` is open leads assigned to me. Customer leads only.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canWriteLeads(session.user.role)) return forbidden();
  const sp = new URLSearchParams();
  const list = req.nextUrl.searchParams.get("list") === "mine" ? "mine" : "call";
  if (list === "call") sp.set("callList", "1");
  sp.set("scope", "mine");
  sp.set("kind", "CUSTOMER");
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (q) sp.set("search", q.slice(0, 80));
  const params = parseLeadListParams(sp);
  const where = buildLeadListWhere(params, { user: session.user });
  const rows = await prisma.lead.findMany({
    where: { AND: [where, { currentStage: { isClosed: false } }] },
    orderBy: params.callListBefore ? [{ nextFollowUpAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }] : [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 60,
    select: { id: true, fullName: true, companyName: true, primaryPhone: true, propertyAddress1: true, city: true, nextFollowUpAt: true, lastContactAt: true, createdAt: true, currentStage: { select: { name: true } } },
  });
  return NextResponse.json(
    rows.map((l) => ({
      id: l.id,
      name: l.companyName || l.fullName,
      phone: l.primaryPhone || null,
      street: [l.propertyAddress1, l.city].filter(Boolean).join(", "),
      stage: l.currentStage.name,
      nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
      lastContactAt: l.lastContactAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
