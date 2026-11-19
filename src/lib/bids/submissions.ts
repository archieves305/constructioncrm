import type { BidSubmissionMethod, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { leadAccessWhere } from "@/lib/access/records";
import { PartnerError } from "@/lib/partners/errors";
import { addSubmission } from "@/lib/partners/submissions";
import { amountForScopes, quotedByScope } from "./proposal-plan";

/**
 * "Send version vN to…": record that a checked proposal version went to
 * some of the project's GCs — one submission per GC, each with the people
 * it went to. The price per GC is the version's lines for the scopes that
 * GC bids (amountForScopes) unless a GC-specific amount is given. This is
 * the moment the follow-up cadence starts from (Stage 1c); nothing is sent
 * from here.
 */
export type SubmissionEntry = { bidId: string; recipientContactIds: string[]; method: BidSubmissionMethod; submittedAt: string | null; amount?: number | null; evidenceFileId?: string | null };

export async function recordSubmissions(projectId: string, input: { versionId: string; entries: SubmissionEntry[] }, viewer: { id: string; role: RoleName }) {
  const v = await prisma.bidProposalVersion.findUnique({ where: { id: input.versionId }, select: { id: true, status: true, bidProjectId: true, organizationId: true, bundleAdjustment: true, exclusions: true, alternates: true, clarifications: true, lines: { select: { scopeId: true, kind: true, amount: true } } } });
  if (!v || v.bidProjectId !== projectId) throw new PartnerError(404, "Proposal not found on this project");
  if (v.status !== "VERIFIED") throw new PartnerError(409, "Only a checked (confirmed) proposal can be recorded as sent");
  if (input.entries.length === 0) throw new PartnerError(400, "Pick at least one GC");
  const lines = v.lines.map((l) => ({ scopeId: l.scopeId, kind: l.kind, amount: Number(l.amount) }));
  const version = { bundleAdjustment: Number(v.bundleAdjustment ?? 0), lines };
  const bids = await prisma.bidInvitation.findMany({ where: { id: { in: input.entries.map((e) => e.bidId) }, bidProjectId: projectId, lead: leadAccessWhere(viewer) }, select: { id: true, number: true, status: true, organizationId: true, scopes: { select: { id: true, scopeId: true } } } });
  if (bids.length !== input.entries.length) throw new PartnerError(404, "A GC is not on this project");
  for (const b of bids) {
    if (b.status === "CLOSED") throw new PartnerError(409, `${b.number} is closed; reopen it first`);
    if (v.organizationId && v.organizationId !== b.organizationId) throw new PartnerError(400, `This version is priced for one GC only; ${b.number} is another`);
  }
  for (const e of input.entries) if (e.method === "EMAIL" && e.recipientContactIds.length === 0) throw new PartnerError(400, "Say who it was emailed to");
  const out: { bidId: string; number: string; amount: number }[] = [];
  for (const e of input.entries) {
    const b = bids.find((x) => x.id === e.bidId)!;
    const scopeIds = b.scopes.map((s) => s.scopeId);
    const amount = e.amount ?? amountForScopes(version, scopeIds);
    if (!(amount > 0)) throw new PartnerError(400, `${b.number}: the proposal prices none of this GC's scopes; give the amount sent`);
    await addSubmission(e.bidId, { amount, method: e.method, submittedAt: e.submittedAt, recipientContactIds: e.recipientContactIds, proposalVersionId: v.id, evidenceFileId: e.evidenceFileId ?? null, confirmedVia: "manual", exclusions: v.exclusions, alternates: v.alternates, clarifications: v.clarifications }, viewer.id);
    // Per-scope quotes come from the version's lines; a GC-specific total has no split, so it leaves them alone.
    const quoted = e.amount == null ? quotedByScope(version, scopeIds) : new Map<string, number | null>();
    for (const s of b.scopes) {
      const q = quoted.get(s.scopeId);
      if (q !== undefined && q !== null) await prisma.bidOpportunityScope.update({ where: { id: s.id }, data: { quotedAmount: q } });
    }
    out.push({ bidId: b.id, number: b.number, amount });
  }
  return { submitted: out };
}
