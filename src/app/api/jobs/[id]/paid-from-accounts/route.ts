import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { jobKindOf } from "@/lib/jobs/stage-kinds";
import { fetchPaidFromAccounts } from "@/lib/integrations/cc-allocator/accounts";

// GET /api/jobs/[id]/paid-from-accounts — the bank accounts and cards a crew
// payment on this job may be paid from, as CC Allocator names them (its
// company rules applied for the job's kind). Money roles, as recording a
// payment. When CC Allocator cannot be reached the list is empty with the
// reason; the payment can still be recorded without it.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });
  const { id } = await context.params;
  const job = await prisma.job.findUnique({ where: { id }, select: { jobType: true, ownedPurpose: true } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const kind = jobKindOf(job);
  const res = await fetchPaidFromAccounts(kind);
  return NextResponse.json(res.ok ? { jobKind: kind, accounts: res.accounts, unavailable: null } : { jobKind: kind, accounts: [], unavailable: res.error });
}
