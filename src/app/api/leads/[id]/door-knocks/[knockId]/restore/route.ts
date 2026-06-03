import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; knockId: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { knockId } = await params;

  // Fetch the knock to check ownership
  const knock = await prisma.propertyDoorKnock.findUnique({
    where: { id: knockId },
  });

  if (!knock) {
    return NextResponse.json({ error: "Knock not found" }, { status: 404 });
  }

  // Only the original knocker or an admin can restore
  const isAdmin = session.user.role === "ADMIN" || session.user.role === "MANAGER";
  if (knock.knockedByUserId !== session.user.id && !isAdmin) {
    return NextResponse.json(
      { error: "Only the original knocker or an admin can restore this knock" },
      { status: 403 }
    );
  }

  // Restore the knock
  const restored = await prisma.propertyDoorKnock.update({
    where: { id: knockId },
    data: {
      isDeleted: false,
      deletedAt: null,
      deletedByUserId: null,
    },
  });

  return NextResponse.json(restored);
}
