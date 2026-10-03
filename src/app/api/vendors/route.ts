import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageVendors, canViewVendors, VENDOR_DENIED_MESSAGE } from "@/lib/vendors/access";
import { createVendor, listVendors } from "@/lib/vendors/service";
import { createVendorSchema, vendorErrorResponse, VENDOR_KINDS } from "@/lib/vendors/validation";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewVendors(session.user.role)) return forbidden();

  const params = request.nextUrl.searchParams;
  const kind = params.get("kind");
  if (kind && !(VENDOR_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "Unknown vendor kind" }, { status: 400 });
  }
  const vendors = await listVendors({
    q: params.get("q")?.trim() || undefined,
    kind: (kind as (typeof VENDOR_KINDS)[number] | null) ?? undefined,
    includeInactive: params.get("inactive") === "1",
    needsDocuments: params.get("needs") === "1",
  });
  return NextResponse.json({ vendors, canManage: canManageVendors(session.user.role) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const v = await validateBody(request, createVendorSchema);
  if (!v.ok) return v.response;
  const { link, ...input } = v.data;
  try {
    const result = await createVendor(input, link, session.user.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
