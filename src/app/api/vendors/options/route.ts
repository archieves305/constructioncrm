import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

/** Id, name and kind of every active vendor, for pickers and suggestions. Any signed-in user. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, trade: true },
  });
  return NextResponse.json(vendors);
}
