import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { releaseCoveredExpenses } from "@/lib/expenses/labor-cover";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const existing = await prisma.laborPayment.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A bank charge this payment accounted for goes back to the review queue.
  await releaseCoveredExpenses([id], session.user.id);
  await prisma.laborPayment.delete({ where: { id } });
  await recordAudit({ actorUserId: session.user.id, entityType: "LaborPayment", entityId: id, action: "delete", before: existing });
  // A linked CC Allocator line now points at nothing; CC Allocator reads that
  // from the status endpoint and puts the line back in its review.
  return NextResponse.json({ ok: true, unlinkedLine: existing.allocatorExternalId });
}

const patchSchema = z.union([
  z.object({
    paidFromKey: z.string().max(200).regex(/^(bank|card):/).nullable(),
    paidFromLabel: z.string().max(120).nullable().optional(),
  }),
  z.object({ unlinkAllocatorLine: z.literal(true) }),
]);

// PATCH /api/labor-payments/[id] — set where a crew payment was paid from
// (until a bank / card line is linked), or unlink the CC Allocator line so it
// goes back to CC Allocator's review. Money roles; audited.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const existing = await prisma.laborPayment.findUnique({ where: { id }, select: { paidFromKey: true, paidFromLabel: true, allocatorExternalId: true, allocatorLineDate: true, allocatorLineAmount: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if ("unlinkAllocatorLine" in parsed.data) {
    if (!existing.allocatorExternalId) return NextResponse.json({ error: "No bank or card line is linked" }, { status: 409 });
    await prisma.laborPayment.update({ where: { id }, data: { allocatorExternalId: null, allocatorLinkedAt: null, allocatorLineDate: null, allocatorLineAmount: null } });
    await recordAudit({ actorUserId: session.user.id, entityType: "LaborPayment", entityId: id, action: "allocator_line_unlinked", before: { externalId: existing.allocatorExternalId, lineDate: existing.allocatorLineDate, lineAmount: existing.allocatorLineAmount } });
    return NextResponse.json({ ok: true });
  }

  if (existing.allocatorExternalId)
    return NextResponse.json({ error: "A bank or card line is linked; unlink it before changing where this was paid from" }, { status: 409 });
  const key = parsed.data.paidFromKey || null;
  const label = key ? parsed.data.paidFromLabel?.trim() || null : null;
  await prisma.laborPayment.update({ where: { id }, data: { paidFromKey: key, paidFromLabel: label } });
  await recordAudit({ actorUserId: session.user.id, entityType: "LaborPayment", entityId: id, action: "paid_from_update", before: { paidFromKey: existing.paidFromKey, paidFromLabel: existing.paidFromLabel }, after: { paidFromKey: key, paidFromLabel: label } });
  return NextResponse.json({ ok: true });
}
