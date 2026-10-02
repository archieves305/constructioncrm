import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { getJobCostSummary } from "@/lib/services/job-cost";

// GET /api/jobs/[id]/cost-summary — contract, estimated cost, spent, committed, remaining, projected profit.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;

  const summary = await getJobCostSummary(id);
  if (!summary) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(summary);
}
