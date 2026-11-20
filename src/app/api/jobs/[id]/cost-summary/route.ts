import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJobMoney } from "@/lib/access/records";
import { getJobCostSummaryWithReturns } from "@/lib/services/job-cost";

// GET /api/jobs/[id]/cost-summary — contract, estimated cost, spent, committed, remaining, projected profit;
// on one of our own projects also all-in cost and what the flip or rental returns (`owned`).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const denied = await guardJobMoney(session.user, id, "full");
  if (denied) return denied;

  const summary = await getJobCostSummaryWithReturns(id);
  if (!summary) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(summary);
}
