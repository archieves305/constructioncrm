import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { validateBody } from "@/lib/validation/body";
import { deleteCommitment, updateCommitment } from "@/lib/vendors/commitment-service";
import { vendorErrorResponse } from "@/lib/vendors/validation";

const updateSchema = z.object({
  vendorId: z.string().min(1).max(60).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  amount: z.number().positive("The amount must be more than zero").max(99_999_999).optional(),
  budgetLineId: z.string().max(60).nullable().optional(),
  committedDate: z.string().max(10).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: z.enum(["OPEN", "CLOSED", "CANCELLED"]).optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const v = await validateBody(request, updateSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateCommitment(id, v.data, session.user.id));
  } catch (err) {
    return vendorErrorResponse(err);
  }
}

/** Only a commitment with no expense against it; otherwise cancel it. */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  try {
    await deleteCommitment(id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
