import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { confirmVersion, versionVisible, type ConfirmProposalInput } from "@/lib/bids/proposals";
import { confirmProposalSchema } from "@/lib/bids/validation";

/** Confirm a reviewed estimate: file it on its project (new or chosen), with its scopes and GCs. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  if (!(await versionVisible(session.user, id))) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  const v = await validateBody(request, confirmProposalSchema);
  if (!v.ok) return v.response;
  const d = v.data;
  const project = "id" in d.project ? { id: d.project.id } : { create: { ...d.project.create, state: d.project.create.state || null }, force: d.project.force };
  try {
    return NextResponse.json(await confirmVersion(id, { ...d, project, proposalNumber: d.proposalNumber ?? null, proposalDate: d.proposalDate || null, validUntil: d.validUntil || null, inclusions: d.inclusions ?? null, exclusions: d.exclusions ?? null, alternates: d.alternates ?? null, clarifications: d.clarifications ?? null, organizationId: d.organizationId ?? null, lines: d.lines.map((l) => ({ ...l, description: l.description ?? null })), gcs: d.gcs.map((g) => ({ organizationId: g.organizationId, contactId: g.contactId ?? null, bidDueAt: g.bidDueAt || null, estimatorUserId: g.estimatorUserId ?? null })) } as ConfirmProposalInput, session.user));
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
