import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const updateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CONVERTED", "DECLINED"]).optional(),
  convertedLeadId: z.string().nullable().optional(),
  commissionAmount: z.number().min(0).nullable().optional(),
  commissionPaidAt: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const data: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.convertedLeadId !== undefined)
    data.convertedLeadId = parsed.data.convertedLeadId;
  if (parsed.data.commissionAmount !== undefined)
    data.commissionAmount = parsed.data.commissionAmount;
  if (parsed.data.commissionPaidAt !== undefined)
    data.commissionPaidAt = parsed.data.commissionPaidAt
      ? new Date(parsed.data.commissionPaidAt)
      : null;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const record = await prisma.referral
    .update({ where: { id }, data })
    .catch(() => null);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(record);
}
