import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { tick } from "@/lib/takeoff/pipeline/runner";
import { guardTakeoffJob } from "@/lib/takeoff/route-guards";
import { getJob } from "@/lib/takeoff/service";

/**
 * Run the job's next steps for up to 40 s and answer with its state. The
 * browser calls this in a loop while someone watches; the cron sweeper does
 * the same for jobs nobody is watching. Two ticks on one job never run the
 * same step (row locks), so an eager client is harmless.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoffJob(session.user, id, "write");
  if (denied) return denied;
  const result = await tick(id);
  const job = await getJob(id);
  return NextResponse.json({ ...result, job });
}
