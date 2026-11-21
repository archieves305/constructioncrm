import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyCcAllocatorAuth } from "@/lib/integrations/cc-allocator/auth";
import { ALLOCATOR_STATUS_SELECT, allocatorExpenseStatus, parseStatusIds } from "@/lib/integrations/cc-allocator/status";

// GET /api/integrations/cc-allocator/expenses?ids=<externalId>,<externalId>
//
// What happened to cc-allocator's postings: for each externalId the CRM holds,
// its status (PENDING = held for a person, APPROVED = counted on the job,
// REJECTED = not counted), why the intake held it, the note and whether a crew
// payment carries the money. `missing` lists ids the CRM does not hold (never
// posted, or the expense was deleted here). Read-only; at most 200 ids.
// CC Allocator → CRM Phase 1, step 3 (cc-allocator mirrors it in step 4).
export async function GET(request: NextRequest) {
  const authFail = verifyCcAllocatorAuth(request);
  if (authFail) return authFail;

  const parsed = parseStatusIds(request.nextUrl.searchParams.getAll("ids"));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const rows = await prisma.jobExpense.findMany({
    where: { externalId: { in: parsed.ids } },
    select: ALLOCATOR_STATUS_SELECT,
  });
  const found = new Set(rows.map((r) => r.externalId));
  return NextResponse.json({
    expenses: rows.map(allocatorExpenseStatus),
    missing: parsed.ids.filter((id) => !found.has(id)),
  });
}
