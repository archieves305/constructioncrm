import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardTakeoffJob } from "@/lib/takeoff/route-guards";
import { getJob } from "@/lib/takeoff/service";

/** A job's status, counters, progress line and any failed steps. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoffJob(session.user, id, "read");
  if (denied) return denied;
  const job = await getJob(id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}
