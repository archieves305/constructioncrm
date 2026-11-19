import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { removeContact, updateContact, type ContactInput } from "@/lib/partners/contacts";
import { partnerErrorResponse, updateContactSchema } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, updateContactSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateContact(id, v.data as Partial<ContactInput>, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

/**
 * Remove a contact: deleted when nothing refers to it, otherwise marked
 * inactive so the interactions and bids it is on keep the person's name.
 */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json(await removeContact(id, session.user.id));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
