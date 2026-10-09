import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { cancelJob } from "@/lib/takeoff/pipeline/runner";
import { guardTakeoffJob } from "@/lib/takeoff/route-guards";
import { getJob } from "@/lib/takeoff/service";

/** Stop a job: pending steps are skipped, a running step finishes on its own. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoffJob(session.user, id, "write");
  if (denied) return denied;
  await cancelJob(id);
  return NextResponse.json(await getJob(id));
}
