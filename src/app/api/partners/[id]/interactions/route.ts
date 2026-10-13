import { NextRequest, NextResponse } from "next/server";
import type { InteractionKind } from "@/generated/prisma/enums";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { listInteractions, logInteraction } from "@/lib/partners/interactions";
import { createInteractionSchema, INTERACTION_KINDS, partnerErrorResponse } from "@/lib/partners/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind");
  const result = await listInteractions(id, {
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 50)),
    kind: kind && (INTERACTION_KINDS as readonly string[]).includes(kind) ? (kind as InteractionKind) : undefined,
  });
  return NextResponse.json(result);
}

/** Log a touch. The account's last-contact date, the contact's, a bid lead's activity and the follow-ups all move with it. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const v = await validateBody(request, createInteractionSchema);
  if (!v.ok) return v.response;
  try {
    const result = await logInteraction(id, v.data, session.user.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
