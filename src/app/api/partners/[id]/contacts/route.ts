import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { createContact, listContacts, type ContactInput } from "@/lib/partners/contacts";
import { createContactSchema, partnerErrorResponse } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const { rows } = await listContacts({ organizationId: id, includeInactive: request.nextUrl.searchParams.get("inactive") === "1", page: 1, pageSize: 500 });
  return NextResponse.json({ contacts: rows });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, createContactSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createContact(id, v.data as ContactInput, session.user.id), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
