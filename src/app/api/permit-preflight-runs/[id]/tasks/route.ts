import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { z } from "zod";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { createPreflightTasks } from "@/lib/permit-intel/preflight-run";
import { runInScope } from "@/lib/permit-intel/run-scope";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Tasks for the picked findings, for the permit's coordinator; each closes when a later preflight passes it. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await runInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, z.object({ codes: z.array(z.string().max(200)).min(1).max(100) }));
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createPreflightTasks(id, v.data.codes, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
