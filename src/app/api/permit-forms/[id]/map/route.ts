import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requestMapping, runMapping } from "@/lib/permit-intel/forms";
import { AI_RATE } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The AI maps the form's fields (after the answer). A field mapped by hand is kept. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
  if (limited) return limited;
  const { id } = await params;
  try {
    await requestMapping(id, actorOf(session.user));
    after(() => runMapping(id, session.user.id));
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
