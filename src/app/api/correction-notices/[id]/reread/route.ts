import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canWriteProduction } from "@/lib/access/roles";
import { requestReread, runExtraction } from "@/lib/permit-intel/corrections";
import { AI_RATE, actorOf, errorResponse, noticeInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Read the notice again; the proposed items are replaced, confirmed ones never touched. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await noticeInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
  if (limited) return limited;
  try {
    await requestReread(id, actorOf(session.user));
    after(() => runExtraction(id, session.user.id));
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
