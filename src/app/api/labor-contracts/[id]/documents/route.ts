import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { GeneratedDocumentType } from "@/generated/prisma/client";

// List the generated labor-contract PDFs for a labor contract (newest first).
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const docs = await prisma.generatedDocument.findMany({
    where: {
      laborContractId: id,
      documentType: {
        in: [
          GeneratedDocumentType.LABOR_CONTRACT,
          GeneratedDocumentType.INTERIOR_RENOVATION_LABOR_CONTRACT,
        ],
      },
    },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      fileName: true,
      fileId: true,
      generatedAt: true,
      generatedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(docs);
}
