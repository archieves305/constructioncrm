import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canApproveJobCosts } from "@/lib/expenses/permissions";
import { canManageJobMoney } from "@/lib/money/access";
import { clearLaborCheck, coverWithLaborPayment, recordAsLaborPayment } from "@/lib/expenses/labor-cover";

/**
 * POST /api/expenses/[id]/labor-payment — decide whether a charge is a crew
 * payment counted twice (lib/expenses/labor-cover.ts):
 *   same_money — it duplicates `laborPaymentId`; it stops counting here.
 *   record     — it is a crew payment nobody recorded; record it on
 *                `laborContractId` and stop counting it here.
 *   separate   — a cost of its own; stop asking (a held row is approved).
 * Approving charges and recording crew payments share one role list:
 * ADMIN, MANAGER, OFFICE_STAFF.
 */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("same_money"), laborPaymentId: z.string().min(1) }),
  z.object({ action: z.literal("record"), laborContractId: z.string().min(1) }),
  z.object({ action: z.literal("separate"), note: z.string().trim().max(2000).optional() }),
]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApproveJobCosts(session.user.role) || !canManageJobMoney(session.user.role)) return forbidden();

  const parsed = await validateBody(request, schema);
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const body = parsed.data;

  const result =
    body.action === "same_money"
      ? await coverWithLaborPayment(id, body.laborPaymentId, session.user.id)
      : body.action === "record"
        ? await recordAsLaborPayment(id, body.laborContractId, session.user.id)
        : await clearLaborCheck(id, session.user.id, body.note);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
