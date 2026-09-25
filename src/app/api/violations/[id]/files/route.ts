import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { requireCase } from "@/lib/violations/route-helpers";

/** Files on the case (and its items). Uploads go through POST /api/files with violationCaseId. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const category = request.nextUrl.searchParams.get("category");
  const rows = await prisma.file.findMany({
    where: { violationCaseId: id, ...(category === "PHOTOS" ? { category: "PHOTOS" } : {}) },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } }, violationItem: { select: { id: true, itemNumber: true } }, task: { select: { id: true, title: true } } },
  });
  return NextResponse.json(rows);
}
