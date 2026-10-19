import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { validateBody } from "@/lib/validation/body";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canWriteProduction } from "@/lib/access/roles";
import { isAiConfigured } from "@/lib/ai/client";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { SCORE_LABEL } from "@/lib/permit-intel/preflight";
import { listRuns, runPermitPreflight } from "@/lib/permit-intel/preflight-run";
import { AI_RATE, actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The permit's preflight runs, newest first, and whether it is marked ready. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  const [runs, ready] = await Promise.all([
    listRuns(id),
    prisma.jobPermit.findUnique({ where: { id }, select: { readyAt: true, readyRunId: true, readyOverride: true, readyBy: { select: { firstName: true, lastName: true } } } }),
  ]);
  const canEdit = canWriteProduction(session.user.role);
  return NextResponse.json({
    runs,
    ready,
    scoreLabel: SCORE_LABEL,
    permissions: { canRun: canEdit, canMarkReady: canEdit && canSubmitPermit(session.user, scope.permit), canOverride: session.user.role === "ADMIN" || session.user.role === "MANAGER", aiReady: isAiConfigured() },
  });
}

/** Run the checks now (`ai: true` adds the AI review, warnings only). */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, z.object({ ai: z.boolean().optional() }));
  if (!v.ok) return v.response;
  if (v.data.ai) {
    const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
    if (limited) return limited;
  }
  try {
    return NextResponse.json(await runPermitPreflight(id, { ai: !!v.data.ai }, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
