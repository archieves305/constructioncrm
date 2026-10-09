import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { guardSheet } from "@/lib/takeoff/route-guards";
import { readSheetText } from "@/lib/takeoff/sheet-cache";

/** The positioned text runs of a sheet, as the worker read them. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "read");
  if (denied) return denied;
  const sheet = await prisma.planSheet.findUnique({ where: { id }, select: { textKey: true } });
  if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
  const text = await readSheetText(sheet);
  if (!text) return NextResponse.json({ error: "This sheet has no text yet" }, { status: 404 });
  return NextResponse.json(text, { headers: { "Cache-Control": "private, max-age=3600" } });
}
