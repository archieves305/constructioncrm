import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewContracts } from "@/lib/customer-contracts/access";

// GET /api/customer-contracts/[id]/documents — every generated version, unsigned and signed.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContracts(session.user.role)) return forbidden();
  const { id } = await params;
  const rows = await prisma.generatedDocument.findMany({
    where: { customerContractId: id },
    orderBy: [{ documentType: "asc" }, { versionNumber: "desc" }],
    select: { id: true, documentType: true, versionNumber: true, fileName: true, fileId: true, generatedAt: true, generatedBy: { select: { firstName: true, lastName: true } } },
  });
  return NextResponse.json(rows);
}
