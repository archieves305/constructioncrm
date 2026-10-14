import { NextRequest, NextResponse } from "next/server";
import type { QualificationStatus } from "@/generated/prisma/enums";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { vaultViewerFor } from "@/lib/partners/grants";
import { listQualifications } from "@/lib/partners/qualifications";
import { QUALIFICATION_STATUSES } from "@/lib/partners/validation";

/** Every qualification across accounts — the Qualifications page and its queues. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const derived = sp.get("derived");
  const days = Number(sp.get("expiringWithinDays"));
  const viewer = await vaultViewerFor(session.user);
  const rows = await listQualifications(
    {
      status: status && (QUALIFICATION_STATUSES as readonly string[]).includes(status) ? (status as QualificationStatus) : undefined,
      derived: derived === "EXPIRED" || derived === "RENEWAL_DUE" || derived === "EXPIRING" ? derived : undefined,
      expiringWithinDays: Number.isFinite(days) && days > 0 ? days : undefined,
      ownerUserId: sp.get("owner") || undefined,
      organizationId: sp.get("organizationId") || undefined,
    },
    viewer,
  );
  return NextResponse.json({ rows, canManage: canManagePartners(session.user.role) });
}
