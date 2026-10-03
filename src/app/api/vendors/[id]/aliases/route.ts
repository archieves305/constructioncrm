import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageVendors, VENDOR_DENIED_MESSAGE } from "@/lib/vendors/access";
import { addAlias, removeAlias } from "@/lib/vendors/service";
import { vendorErrorResponse } from "@/lib/vendors/validation";

const addSchema = z.object({ text: z.string().trim().min(1).max(200) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const v = await validateBody(request, addSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addAlias(id, v.data.text, session.user.id), { status: 201 });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageVendors(session.user.role)) return NextResponse.json({ error: VENDOR_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const aliasId = request.nextUrl.searchParams.get("aliasId");
  if (!aliasId) return NextResponse.json({ error: "aliasId is required" }, { status: 400 });
  try {
    await removeAlias(id, aliasId, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
