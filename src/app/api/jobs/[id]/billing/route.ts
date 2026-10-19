import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJobMoney } from "@/lib/access/records";
import { getBillingSummary } from "@/lib/services/progress-billing";

/** Progress-billing read model: schedule of values, applications, G702 totals. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const denied = await guardJobMoney(session.user, id, "price");
  if (denied) return denied;
  const summary = await getBillingSummary(id);
  if (!summary) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(summary);
}
