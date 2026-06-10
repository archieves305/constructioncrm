import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recomputeJobLabor } from "@/lib/services/job-pricing";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.laborChangeOrder.findUnique({
    where: { id },
    include: { laborContract: { select: { jobId: true } } },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.laborChangeOrder.delete({ where: { id } });
  await recomputeJobLabor(existing.laborContract.jobId);

  return NextResponse.json({ ok: true });
}
