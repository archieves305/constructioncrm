import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { fileIntakeOnProject } from "@/lib/partners/itb-intake";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { guardProject } from "@/lib/bids/access";
import { intakeToProjectSchema } from "@/lib/bids/validation";

/** File a PlanHub invitation under a bid project: this GC becomes an opportunity on it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const v = await validateBody(request, intakeToProjectSchema);
  if (!v.ok) return v.response;
  if (v.data.projectId) {
    const hidden = await guardProject(session.user, v.data.projectId);
    if (hidden) return hidden;
  }
  const d = v.data;
  try {
    const res = await fileIntakeOnProject(
      (await params).id,
      { projectId: d.projectId ?? null, createProject: d.createProject ? { ...d.createProject, state: d.createProject.state || null, scopes: [] } : null, organizationId: d.organizationId, contactId: d.contactId ?? null, scopeServiceCategoryIds: d.scopeServiceCategoryIds, bidDueAt: d.bidDueAt || null, estimatorUserId: d.estimatorUserId ?? null },
      session.user.id,
    );
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
