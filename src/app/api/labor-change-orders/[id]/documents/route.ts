import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardJobMoney } from "@/lib/access/records";
import { GeneratedDocumentType } from "@/generated/prisma/client";

// List the generated addendum PDFs for a change order (newest first).
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const co = await prisma.laborChangeOrder.findUnique({ where: { id }, select: { laborContract: { select: { jobId: true } } } });
  if (!co) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = await guardJobMoney(session.user, co.laborContract.jobId, "full");
  if (denied) return denied;
  const docs = await prisma.generatedDocument.findMany({
    where: {
      changeOrderId: id,
      documentType: GeneratedDocumentType.CONTRACT_ADDENDUM,
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
