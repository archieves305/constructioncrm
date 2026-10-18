import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canWriteProduction } from "@/lib/access/roles";
import { canConfirmCorrections, canSendPermitMessage } from "@/lib/permit-intel/access";
import { createNotice, loadCorrections, runExtraction } from "@/lib/permit-intel/corrections";
import { noticeCreateSchema } from "@/lib/permit-intel/correction-validation";
import { listMessages } from "@/lib/permit-intel/messages";
import { AI_RATE, actorOf, errorResponse, involvedWithJob, permitInScope } from "@/lib/permit-intel/route";
import { isAiConfigured } from "@/lib/ai/client";

type Context = { params: Promise<{ id: string }> };

/** The permit's correction notices with their items, and its emails. A reading a restart cut off is started again. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  const [corrections, messages, involved] = await Promise.all([loadCorrections(id), listMessages(id), involvedWithJob(session.user.id, scope.permit.jobId)]);
  for (const noticeId of corrections.restart) after(() => runExtraction(noticeId, null));
  const canEdit = canWriteProduction(session.user.role);
  return NextResponse.json({
    notices: corrections.notices,
    messages,
    permissions: {
      canEdit,
      canConfirm: canEdit && canConfirmCorrections(session.user, scope.permit),
      canSend: canEdit && canSendPermitMessage(session.user, involved),
      aiReady: isAiConfigured(),
    },
  });
}

/** A correction notice arrived: uploaded (already on the permit as a file) or pasted. The AI reads it after the answer. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
  if (limited) return limited;
  const v = await validateBody(request, noticeCreateSchema);
  if (!v.ok) return v.response;
  try {
    const notice = await createNotice(id, v.data, actorOf(session.user));
    if (notice.status === "EXTRACTING") after(() => runExtraction(notice.id, session.user.id));
    return NextResponse.json(notice, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
