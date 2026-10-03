import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";
import { canManageJobMoney, MONEY_DENIED_MESSAGE } from "@/lib/money/access";
import { validateBody } from "@/lib/validation/body";
import { createCommitment, listJobCommitments } from "@/lib/vendors/commitment-service";
import { vendorErrorResponse } from "@/lib/vendors/validation";

const createSchema = z.object({
  vendorId: z.string().min(1, "Choose a vendor").max(60),
  description: z.string().trim().min(1, "Say what was ordered or promised").max(2000),
  amount: z.number().positive("The amount must be more than zero").max(99_999_999),
  budgetLineId: z.string().max(60).nullable().optional(),
  committedDate: z.string().max(10).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

/** A job's commitments with what each has received and what is still open, and its labor contracts as read-only rows. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await context.params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;
  return NextResponse.json({ ...(await listJobCommitments(id)), canManage: canManageJobMoney(session.user.role) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageJobMoney(session.user.role)) return NextResponse.json({ error: MONEY_DENIED_MESSAGE }, { status: 403 });

  const { id } = await context.params;
  const v = await validateBody(request, createSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createCommitment(id, v.data, session.user.id), { status: 201 });
  } catch (err) {
    return vendorErrorResponse(err);
  }
}
