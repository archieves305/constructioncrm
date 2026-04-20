import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await context.params;
  const result = await prisma.notificationEvent.updateMany({
    where: { id, recipientUserId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ updated: result.count });
}
