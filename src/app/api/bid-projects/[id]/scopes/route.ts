import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { addScopes, getProject } from "@/lib/bids/project";
import { guardProject } from "@/lib/bids/access";
import { addScopesSchema } from "@/lib/bids/validation";

/** Add trade scopes (packages) to the project. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardProject(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, addScopesSchema);
  if (!v.ok) return v.response;
  try {
    await addScopes(id, v.data.scopes, session.user.id);
    return NextResponse.json(await getProject(id, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
