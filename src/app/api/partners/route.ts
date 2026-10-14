import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { parseOrgListParams } from "@/lib/partners/query";
import { createOrganization, listOrganizations, type OrganizationInput } from "@/lib/partners/service";
import { createOrganizationSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** GC Partnerships: the accounts list, and a new account. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  try {
    const params = parseOrgListParams(request.nextUrl.searchParams);
    return NextResponse.json(await listOrganizations(params, { user: { id: session.user.id, role: session.user.role } }));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, createOrganizationSchema);
  if (!v.ok) return v.response;
  try {
    const detail = await createOrganization(v.data as OrganizationInput, session.user.id, session.user);
    return NextResponse.json(detail, { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
