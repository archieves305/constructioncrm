import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCcAllocatorAuth } from "@/lib/integrations/cc-allocator/auth";
import { crewPaymentMatches, jobCrewSummary } from "@/lib/labor/allocator-link-run";

// GET /api/integrations/cc-allocator/crew-payments?jobId=<id>
//   A job's crews: each labor contract (paid so far, open payment requests)
//   and the crew payments recorded here that no bank / card line is linked to.
// GET /api/integrations/cc-allocator/crew-payments?amount=&date=&payee=&account=
//   Crew payments (any job) a bank or card line may be: same money within 3
//   days, the crew named in the payee, never another account. `prefill` is
//   the one CC Allocator may fill in; otherwise a person picks.
//
// Crew payments, one posting (2026-11-21): CC Allocator posts the line to
// QuickBooks and sends it back as a crew payment (expense POST, crew mode),
// never as a job expense. Read-only.
export async function GET(request: NextRequest) {
  const authFail = verifyCcAllocatorAuth(request);
  if (authFail) return authFail;
  const sp = request.nextUrl.searchParams;

  const jobId = sp.get("jobId")?.trim();
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(await jobCrewSummary(jobId));
  }

  const amount = Number(sp.get("amount"));
  const date = new Date(sp.get("date") ?? "");
  if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(date.getTime()))
    return NextResponse.json({ error: "jobId, or amount (> 0) and date, are required" }, { status: 400 });
  return NextResponse.json(
    await crewPaymentMatches({ amount, date, payee: sp.get("payee")?.slice(0, 300) || null, accountKey: sp.get("account")?.slice(0, 200) || null }),
  );
}
