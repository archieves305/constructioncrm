import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const { id } = await params;
  const body = await request.json();

  const crew = await prisma.crew.update({
    where: { id },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.tradeType && { tradeType: body.tradeType }),
      ...(typeof body.isActive === "boolean" && { isActive: body.isActive }),
    },
  });

  return NextResponse.json(crew);
}
