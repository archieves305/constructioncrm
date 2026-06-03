import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; knockId: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { knockId } = await params;

  // Soft delete the knock
  const knock = await prisma.propertyDoorKnock.update({
    where: { id: knockId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedByUserId: session.user.id,
    },
  });

  return NextResponse.json(knock);
}
