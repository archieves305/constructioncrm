import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJob } from "@/lib/access/records";

// GET /api/jobs/[id]/budget — budget lines with their linked spend.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const denied = await guardJob(session.user, id, "read");
  if (denied) return denied;
  const lines = await prisma.budgetLine.findMany({
    where: { jobId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      allocations: {
        select: {
          id: true,
          amount: true,
          expenseId: true,
          laborContractId: true,
        },
      },
    },
  });
  return NextResponse.json(lines);
}
