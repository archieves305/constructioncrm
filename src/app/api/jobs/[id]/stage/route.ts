import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";
import { changeJobStage } from "@/lib/services/jobs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const { stageId, reason } = await request.json();
  if (!stageId) return badRequest("stageId is required");

  const updated = await changeJobStage(id, stageId, session.user.id, reason);
  return NextResponse.json(updated);
}
