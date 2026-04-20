import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function POST() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const result = await prisma.notificationEvent.updateMany({
    where: { recipientUserId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ updated: result.count });
}
