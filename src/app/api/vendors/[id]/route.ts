import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageVendors, canViewVendors, VENDOR_DENIED_MESSAGE } from "@/lib/vendors/access";
import { getVendorDetail, updateVendor } from "@/lib/vendors/service";
import { listVendorCommitments } from "@/lib/vendors/commitment-service";
import { updateVendorSchema, vendorErrorResponse } from "@/lib/vendors/validation";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewVendors(session.user.role)) return forbidden();

  const { id } = await context.params;
  const detail = await getVendorDetail(id);
  if (!detail) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  return NextResponse.json({ ...detail, commitments: await listVendorCommitments(id), canManage: canManageVendors(session.user.role) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const v = await validateBody(request, updateVendorSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateVendor(id, v.data, session.user.id));
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
