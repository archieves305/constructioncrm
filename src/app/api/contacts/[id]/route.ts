import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { updateContact, type ContactInput } from "@/lib/partners/contacts";
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

/** A contact is never deleted — people move; the record is deactivated and kept on the interactions it is on. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  try {
    await updateContact(id, { isActive: false, isPrimary: false }, session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
