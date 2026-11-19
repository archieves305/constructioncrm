import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { guardProject } from "@/lib/bids/access";
import { recordSubmissions } from "@/lib/bids/submissions";
import { recordSubmissionsSchema } from "@/lib/bids/validation";

/** Record that a checked proposal version went to some of the project's GCs (one submission each). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardProject(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, recordSubmissionsSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await recordSubmissions(id, { versionId: v.data.versionId, entries: v.data.entries.map((e) => ({ ...e, submittedAt: e.submittedAt || null })) }, session.user), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
