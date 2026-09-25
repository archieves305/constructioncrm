import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { categorySchema } from "@/lib/validators/violation";
import { canManageCategories } from "@/lib/violations/access";
import { createCategory, listCategories } from "@/lib/violations/categories";
import { violationErrorResponse } from "@/lib/violations/route-helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageCategories(session.user.role)) return forbidden();
  return NextResponse.json(await listCategories({ includeInactive: true }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageCategories(session.user.role)) return forbidden();
  const parsed = await validateBody(request, categorySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await createCategory(parsed.data, session.user), { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
