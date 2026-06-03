import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; knockId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id: prospectId, knockId } = await params;

  // Soft delete, scoped to the prospect so a knockId from elsewhere can't be hit.
  const { count } = await prisma.propertyDoorKnock.updateMany({
    where: { id: knockId, prospectId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedByUserId: session.user.id,
    },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Knock not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
