import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { canManageProgressBilling } from "@/lib/services/progress-billing";

const createSchema = z.object({
  description: z.string().trim().min(1).max(500),
  scheduledValue: z.number().min(0),
});

/** Add a schedule-of-values line. Item numbers continue from the highest. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageProgressBilling(session.user.role)) return forbidden();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const agg = await prisma.sovLine.aggregate({
    where: { jobId: id },
    _max: { itemNo: true, sortOrder: true },
  });
  const line = await prisma.sovLine.create({
    data: {
      jobId: id,
      itemNo: (agg._max.itemNo ?? 0) + 1,
      sortOrder: (agg._max.sortOrder ?? -1) + 1,
      description: parsed.data.description,
      scheduledValue: parsed.data.scheduledValue,
    },
  });
  return NextResponse.json(line, { status: 201 });
}
