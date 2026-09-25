import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { acknowledgeMissingPosting, unacknowledgePosting } from "@/lib/expenses/acknowledge-posting";

/**
 * Acknowledge that a cc-allocator posting is deliberately absent from the
 * CRM; DELETE undoes it. Same explicit role list as approving a charge.
 */
const bodySchema = z.object({
  externalId: z.string().min(1).max(200),
  note: z.string().trim().max(2000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApproveJobCosts(session.user.role)) return forbidden();
  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;
  const r = await acknowledgeMissingPosting(v.data, { userId: session.user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApproveJobCosts(session.user.role)) return forbidden();
  const v = await validateBody(request, bodySchema.pick({ externalId: true }));
  if (!v.ok) return v.response;
  const r = await unacknowledgePosting(v.data.externalId, { userId: session.user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
