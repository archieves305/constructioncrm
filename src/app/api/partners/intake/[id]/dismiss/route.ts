import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { dismissIntake } from "@/lib/partners/itb-intake";
import { intakeDismissSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Not a bid for KNU (spam, a duplicate, a newsletter): out of the queue, kept on record. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, intakeDismissSchema);
  if (!v.ok) return v.response;
  try {
    await dismissIntake((await params).id, v.data.reason ?? null, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
