import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { fineSummaryFor } from "@/lib/violations/fines";
import { requireCase } from "@/lib/violations/route-helpers";

/** The ledger plus both figures — the system estimate and the official balance — labelled apart. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user, (p) => p.canViewFinancials);
  if ("response" in gate) return gate.response;
  const c = await prisma.codeViolationCase.findUnique({ where: { id }, include: { fineEntries: { orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] } } });
  if (!c) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  const { fineEntries, ...rest } = c;
  return NextResponse.json({ summary: fineSummaryFor(rest, new Date()), entries: fineEntries, terms: { initialFine: c.initialFine, dailyFine: c.dailyFine, fineAccrualStartDate: c.fineAccrualStartDate, fineAccrualStoppedAt: c.fineAccrualStoppedAt, adminCosts: c.adminCosts, amountPaid: c.amountPaid, mitigationStatus: c.mitigationStatus, mitigationRequestedAmount: c.mitigationRequestedAmount, mitigationGrantedAmount: c.mitigationGrantedAmount, fineResolvedAt: c.fineResolvedAt, fineEstimateOverride: c.fineEstimateOverride, fineEstimateOverrideReason: c.fineEstimateOverrideReason, fineEstimateOverrideAt: c.fineEstimateOverrideAt, lienStatus: c.lienStatus, lienAmount: c.lienAmount, lienRecordedAt: c.lienRecordedAt, lienInstrumentNumber: c.lienInstrumentNumber, lienBookPage: c.lienBookPage, lienReleasedAt: c.lienReleasedAt, lienReleaseInstrumentNumber: c.lienReleaseInstrumentNumber } });
}
