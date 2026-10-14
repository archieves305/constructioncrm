import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { AI_NOT_CONFIGURED, isAiConfigured } from "@/lib/takeoff/ai/client";
import { guardTakeoff } from "@/lib/takeoff/route-guards";
import { getJob } from "@/lib/takeoff/service";
import { startAnalysis } from "@/lib/takeoff/takeoff-service";

/**
 * Start the AI analysis of a takeoff: a job the browser (or the cron
 * sweeper) ticks. 503 when the server has no key, 409 while one is running.
 * Edit role, on the takeoff's lead.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "write");
  if (denied) return denied;
  if (!isAiConfigured()) return NextResponse.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
  const started = await startAnalysis(id, session.user.id);
  if (!started) return NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
  if ("error" in started) return NextResponse.json({ error: started.error }, { status: started.status });
  return NextResponse.json({ job: await getJob(started.jobId) }, { status: 202 });
}
