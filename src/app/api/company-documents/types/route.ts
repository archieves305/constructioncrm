import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canAdminPartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { listDocumentTypes, upsertDocumentType } from "@/lib/partners/documents";
import { documentTypeSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** The kinds of document a GC may ask for — seeded, and editable by a manager because every GC's list differs. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  return NextResponse.json({ types: await listDocumentTypes(request.nextUrl.searchParams.get("inactive") === "1"), canEdit: canAdminPartners(session.user.role) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canAdminPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, documentTypeSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await upsertDocumentType(v.data, session.user.id), { status: v.data.id ? 200 : 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
