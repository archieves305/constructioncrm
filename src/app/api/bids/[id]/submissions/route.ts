import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardBid } from "@/lib/partners/bid-guard";
import { validateBody } from "@/lib/validation/body";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { addSubmission, type SubmissionInput } from "@/lib/partners/submissions";
import { bidSubmissionSchema, partnerErrorResponse } from "@/lib/partners/validation";

/** Record a bid as sent: the amount, the estimate it came from, when and how. Append-only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const { id } = await params;
  const hidden = await guardBid(session.user, id);
  if (hidden) return hidden;
  const v = await validateBody(request, bidSubmissionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addSubmission(id, v.data as SubmissionInput, session.user.id), { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
