import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { retryJob } from "@/lib/takeoff/pipeline/runner";
import { guardTakeoffJob } from "@/lib/takeoff/route-guards";
import { getJob } from "@/lib/takeoff/service";

/** Put every failed step back in the queue. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoffJob(session.user, id, "write");
  if (denied) return denied;
  await retryJob(id);
  return NextResponse.json(await getJob(id));
}
