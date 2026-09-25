import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { fetchAllocatorPostings, type AllocatorPosting } from "@/lib/integrations/cc-allocator/postings";

/**
 * Acknowledge that a cc-allocator posting is deliberately absent from the
 * CRM (deleted here on purpose), so the Cost Reconciliation page stops
 * listing it as "missing here". Checks the posting really is missing right
 * now. Shared by the admin route and the one-off script that recorded
 * Richard's 2026-09-24 ruling on the three known deletions.
 */
export type AcknowledgeResult =
  | { ok: true; id: string; posting: AllocatorPosting }
  | { ok: false; status: 400 | 404 | 409 | 502 | 503; error: string };

export async function acknowledgeMissingPosting(
  input: { externalId: string; note?: string | null },
  actor: { userId: string | null },
): Promise<AcknowledgeResult> {
  const a = await fetchAllocatorPostings();
  if (!a.configured) return { ok: false, status: 503, error: "cc-allocator's export is not connected" };
  if (!a.ok) return { ok: false, status: 502, error: a.error };
  const posting = a.data.postings.find((p) => p.externalId === input.externalId);
  if (!posting) return { ok: false, status: 404, error: "cc-allocator has no posting with that id" };
  if (!posting.crmExpenseId) return { ok: false, status: 400, error: "That row never posted to the CRM; it is in cc-allocator's queue, not missing" };
  const here = await prisma.jobExpense.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
  if (here) return { ok: false, status: 400, error: "The CRM still holds that posting; nothing to acknowledge" };
  const existing = await prisma.allocatorPostingAck.findUnique({ where: { externalId: posting.externalId } });
  if (existing) return { ok: false, status: 409, error: "Already acknowledged" };

  const ack = await prisma.allocatorPostingAck.create({
    data: {
      externalId: posting.externalId,
      source: posting.source,
      amount: posting.amount,
      payee: posting.payee,
      postedOn: new Date(`${posting.date}T12:00:00Z`),
      crmJobId: posting.crmJobId,
      note: input.note?.trim() || null,
      decidedByUserId: actor.userId,
    },
  });
  await recordAudit({
    actorUserId: actor.userId,
    entityType: "AllocatorPosting",
    entityId: posting.externalId,
    action: "allocator_posting_acknowledged",
    after: { amount: posting.amount, payee: posting.payee, date: posting.date, crmJobId: posting.crmJobId, note: ack.note },
  });
  return { ok: true, id: ack.id, posting };
}

export async function unacknowledgePosting(externalId: string, actor: { userId: string | null }): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  const existing = await prisma.allocatorPostingAck.findUnique({ where: { externalId } });
  if (!existing) return { ok: false, status: 404, error: "Not acknowledged" };
  await prisma.allocatorPostingAck.delete({ where: { id: existing.id } });
  await recordAudit({
    actorUserId: actor.userId,
    entityType: "AllocatorPosting",
    entityId: existing.externalId,
    action: "allocator_posting_unacknowledged",
    before: { amount: Number(existing.amount), payee: existing.payee, note: existing.note },
  });
  return { ok: true };
}
