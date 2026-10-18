import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canWriteProduction } from "@/lib/access/roles";
import { canSendPermitMessage } from "@/lib/permit-intel/access";
import { sendMessage } from "@/lib/permit-intel/messages";
import { errorResponse, involvedWithJob, mailActorOf, messageInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Send a draft — the only way an email about a permit leaves the CRM. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await messageInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role) || !canSendPermitMessage(session.user, await involvedWithJob(session.user.id, scope.permit.jobId))) return forbidden();
  try {
    return NextResponse.json(await sendMessage(id, mailActorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}
