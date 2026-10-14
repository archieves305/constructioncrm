import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { listContacts } from "@/lib/partners/contacts";
import { parseContactListParams } from "@/lib/partners/query";

/** People across every account — the Contacts page. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { rows, total } = await listContacts(parseContactListParams(request.nextUrl.searchParams));
  return NextResponse.json({ rows, total, canManage: canManagePartners(session.user.role) });
}
