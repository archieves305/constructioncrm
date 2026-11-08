import { NextRequest, NextResponse } from "next/server";
import { AiError } from "@/lib/ai/client";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { requireJobFieldAccess } from "@/lib/labor/route-helpers";
import { logger } from "@/lib/logger";
import { logDraftRequest } from "@/lib/mobile-api";
import { draftLog } from "@/lib/mobile-ai/drafts";
import { validateBody } from "@/lib/validation/body";

/**
 * POST /api/mobile/ai/log-draft — the day's log sections drafted from what
 * the crew lead said. Saves nothing: the phone fills its log form with it,
 * unsaved. Needs the same access as writing the job's log.
 */
export async function POST(request: NextRequest) {
  // Sign-in first, so a caller who is not signed in learns nothing about the body.
  if (!(await getSession())?.user) return unauthorized();
  const v = await validateBody(request, logDraftRequest);
  if (!v.ok) return v.response;
  const ctx = await requireJobFieldAccess(v.data.jobId, "write");
  if ("response" in ctx) return ctx.response;
  try {
    const u = ctx.session.user;
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
    const draft = await draftLog({ id: u.id, role: u.role, name }, v.data.jobId, v.data.date, v.data.speech);
    return NextResponse.json(draft);
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    logger.exception(err, { where: "mobile.ai.log-draft", jobId: v.data.jobId });
    return NextResponse.json({ error: "The draft could not be made. Type the log instead." }, { status: 500 });
  }
}
