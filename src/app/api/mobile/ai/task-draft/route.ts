import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { AiError } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { taskDraftRequest } from "@/lib/mobile-api";
import { draftTask } from "@/lib/mobile-ai/drafts";
import { validateBody } from "@/lib/validation/body";

/**
 * POST /api/mobile/ai/task-draft — a task drafted from what the person said.
 * Saves nothing: the phone shows it on the New task form to check and save.
 * Offered the jobs the person can see and the active staff, as for creating a
 * task by hand; read-only users create no tasks, so they get no drafts.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "READ_ONLY") return forbidden();
  const v = await validateBody(request, taskDraftRequest);
  if (!v.ok) return v.response;
  try {
    const name = `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim() || session.user.email;
    const draft = await draftTask({ id: session.user.id, role: session.user.role, name }, v.data.speech, v.data.jobId);
    return NextResponse.json(draft);
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    logger.exception(err, { where: "mobile.ai.task-draft" });
    return NextResponse.json({ error: "The draft could not be made. Type the task instead." }, { status: 500 });
  }
}
