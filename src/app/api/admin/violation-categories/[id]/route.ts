import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { categoryPatchSchema } from "@/lib/validators/violation";
import { canManageCategories } from "@/lib/violations/access";
import { deleteCategory, updateCategory } from "@/lib/violations/categories";
import { violationErrorResponse } from "@/lib/violations/route-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageCategories(session.user.role)) return forbidden();
  const { id } = await params;
  const parsed = await validateBody(request, categoryPatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await updateCategory(id, parsed.data, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageCategories(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    return NextResponse.json(await deleteCategory(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
