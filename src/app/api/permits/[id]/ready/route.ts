import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { z } from "zod";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { clearReady, markReady } from "@/lib/permit-intel/preflight-run";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Mark the permit ready to submit (a fresh preflight first; blockers need an ADMIN / MANAGER override with a reason). */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role) || !canSubmitPermit(session.user, scope.permit)) return forbidden();
  const v = await validateBody(request, z.object({ overrideReason: z.string().trim().max(2000).nullable().optional() }));
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await markReady(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Take the mark off (something changed). */
export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role) || !canSubmitPermit(session.user, scope.permit)) return forbidden();
  try {
    await clearReady(id, actorOf(session.user), "Taken off by a person");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
