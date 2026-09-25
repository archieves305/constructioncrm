import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { resolvePair } from "@/lib/expenses/resolve-pair";

const schema = z.object({
  manualExpenseId: z.string().min(1),
  externalExpenseId: z.string().min(1),
  decision: z.enum(["DUPLICATE", "KEEP"]),
  note: z.string().trim().max(2000).nullable().optional(),
});

/** Rule on one pair. DUPLICATE deletes the manual charge (audited); KEEP records that both are real. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApproveJobCosts(session.user.role)) return forbidden();

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;

  const result = await resolvePair(v.data, { userId: session.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
