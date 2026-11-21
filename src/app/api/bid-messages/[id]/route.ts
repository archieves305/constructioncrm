import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { guardBid } from "@/lib/partners/bid-guard";
import { bidIdOfMessage, discardDraft, markDraftSent, sendDraft, updateDraft } from "@/lib/bids/follow-ups";
import { draftActionSchema, draftPatchSchema } from "@/lib/bids/follow-up-validation";

async function guard(id: string) {
  const session = await getSession();
  if (!session?.user) return { error: unauthorized() };
  if (!canManagePartners(session.user.role)) return { error: NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 }) };
  const bidId = await bidIdOfMessage(id);
  if (!bidId) return { error: NextResponse.json({ error: "Email not found" }, { status: 404 }) };
  const hidden = await guardBid(session.user, bidId);
  if (hidden) return { error: hidden };
  return { user: session.user };
}

/** Edit a follow-up draft before it goes. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const v = await validateBody(request, draftPatchSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateDraft(id, v.data, g.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}

/** Send it from the CRM, record that it went from Outlook, or discard it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const v = await validateBody(request, draftActionSchema);
  if (!v.ok) return v.response;
  try {
    if (v.data.action === "send") await sendDraft(id, g.user);
    else if (v.data.action === "mark_sent") await markDraftSent(id, g.user);
    else await discardDraft(id, v.data.reason, g.user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
