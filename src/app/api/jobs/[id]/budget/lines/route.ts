import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(120).nullable().optional(),
  amount: z.number().min(0),
});

// POST /api/jobs/[id]/budget/lines — add a single budget line manually.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return badRequest(parsed.error.issues[0]?.message || "invalid payload");

  const last = await prisma.budgetLine.findFirst({
    where: { jobId: id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const line = await prisma.budgetLine.create({
    data: {
      jobId: id,
      name: parsed.data.name.trim(),
      category: parsed.data.category?.trim() || null,
      amount: parsed.data.amount,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  return NextResponse.json(line, { status: 201 });
}
