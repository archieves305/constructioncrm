import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardLead } from "@/lib/access/records";
import { preselectWonEstimate } from "@/lib/estimates/job-from-estimate";
import { wonEstimateOptions } from "@/lib/estimates/job-from-estimate-load";

// GET /api/leads/[id]/won-estimates — the estimates the Won dialog offers, and
// the one it preselects (the accepted one, else the latest sent). Lead write
// access: only someone who may mark the lead Won asks.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardLead(session.user, id, "write");
  if (denied) return denied;
  const options = await wonEstimateOptions(id);
  return NextResponse.json({ options, preselect: preselectWonEstimate(options) });
}
