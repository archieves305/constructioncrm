import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { getArAging, getFinancialSummary, getProgressPositions } from "@/lib/services/financials";

// GET /api/reports/financials — company A/R aging + financial summary.
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const [aging, summary, progress] = await Promise.all([
    getArAging(),
    getFinancialSummary(),
    getProgressPositions(),
  ]);

  return NextResponse.json({ aging, summary, progress });
}
