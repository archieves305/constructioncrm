import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob, jobMoneyViewFor } from "@/lib/access/records";
import { loadJobOverview, redactOverview } from "@/lib/jobs/overview";

// GET /api/jobs/[id]/overview — the job's state on one screen.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;

  const overview = await loadJobOverview(id);
  const view = await jobMoneyViewFor(session.user, id);
  if (!overview || !view) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(redactOverview(overview, view));
}
