import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canWriteProduction } from "@/lib/access/roles";
import { createMessage } from "@/lib/permit-intel/messages";
import { messageCreateSchema } from "@/lib/permit-intel/correction-validation";
import { AI_RATE, errorResponse, mailActorOf, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** A new email draft about the permit — typed, or first written by the AI (`ai: true`) from correction items. Nothing is sent. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, messageCreateSchema);
  if (!v.ok) return v.response;
  if (v.data.ai) {
    const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
    if (limited) return limited;
  }
  try {
    return NextResponse.json(await createMessage(id, v.data, mailActorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
