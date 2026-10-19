import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { loadAssist, startAssistRun, stepAssistRun } from "@/lib/permit-intel/assist-run";
import { MAX_UPLOADS_PER_RUN } from "@/lib/permit-intel/assist-plan";
import { actorOf, AI_RATE, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The permit's latest assistant pass; work that was cut off is taken up again after the answer. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  try {
    const data = await loadAssist(id);
    if (data.restart && data.run) {
      const runId = data.run.id;
      after(() => stepAssistRun(runId, null));
    }
    return NextResponse.json({ ...data, canRun: canWriteProduction(session.user.role), canMakeForms: canManagePermitSettings(session.user.role) });
  } catch (err) {
    return errorResponse(err);
  }
}

const startSchema = z.object({
  fileIds: z.array(z.string().max(60)).max(MAX_UPLOADS_PER_RUN).default([]),
  includeUntyped: z.boolean().default(false),
  searchSite: z.boolean().default(false),
});

/** Hand the assistant documents already uploaded to the permit (and, if asked, the department's website). */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
  if (limited) return limited;
  const v = await validateBody(request, startSchema);
  if (!v.ok) return v.response;
  try {
    const run = await startAssistRun(id, v.data, actorOf(session.user));
    const userId = session.user.id;
    after(() => stepAssistRun(run.id, userId));
    return NextResponse.json(run, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
