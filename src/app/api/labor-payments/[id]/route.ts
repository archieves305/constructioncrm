import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const existing = await prisma.laborPayment.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.laborPayment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
