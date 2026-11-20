import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { changeJobStage, JobStageKindError } from "@/lib/services/jobs";
import { guardJob } from "@/lib/access/records";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "write");
  if (denied) return denied;
  const { stageId, reason } = await request.json();
  if (!stageId) return badRequest("stageId is required");

  try {
    const updated = await changeJobStage(id, stageId, session.user.id, reason);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof JobStageKindError) return badRequest(err.message);
    throw err;
  }
}
