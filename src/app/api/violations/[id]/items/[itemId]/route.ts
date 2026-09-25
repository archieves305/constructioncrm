import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { itemPatchSchema } from "@/lib/validators/violation";
import { removeItem, updateItem } from "@/lib/violations/items";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, itemId } = await params;
  const parsed = await validateBody(request, itemPatchSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await updateItem(id, itemId, parsed.data, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, itemId } = await params;
  const gate = await requireCase(id, session.user, (p) => p.canAssign);
  if ("response" in gate) return gate.response;
  try {
    await removeItem(id, itemId, session.user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
