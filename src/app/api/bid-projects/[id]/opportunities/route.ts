import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { addOpportunity } from "@/lib/bids/project";
import { guardProject } from "@/lib/bids/access";
import { addOpportunitySchema } from "@/lib/bids/validation";

/** Add a GC to the project: its own opportunity and GC_BID lead, bidding the chosen scopes. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardProject(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, addOpportunitySchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addOpportunity(id, v.data, session.user.id), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
