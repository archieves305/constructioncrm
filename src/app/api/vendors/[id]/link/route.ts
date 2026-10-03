import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageVendors, VENDOR_DENIED_MESSAGE } from "@/lib/vendors/access";
import { linkVendor } from "@/lib/vendors/service";
import { linkSchema, vendorErrorResponse } from "@/lib/vendors/validation";

/** Connect an existing vendor to a payee spelling, a crew, or a contractor name typed on labor contracts. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const v = await validateBody(request, linkSchema);
  if (!v.ok) return v.response;
  if (!v.data.payee?.trim() && !v.data.crewId && !v.data.contractLabel?.trim()) {
    return NextResponse.json({ error: "Nothing to link" }, { status: 400 });
  }
  try {
    return NextResponse.json(await linkVendor(id, v.data, session.user.id));
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
