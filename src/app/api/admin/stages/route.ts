import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const stages = await prisma.leadStage.findMany({
    orderBy: { stageOrder: "asc" },
  });

  return NextResponse.json(stages);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.name || body.stageOrder === undefined) {
    return badRequest("name and stageOrder are required");
  }

  const stage = await prisma.leadStage.create({
    data: {
      name: body.name,
      stageOrder: body.stageOrder,
      isClosed: body.isClosed || false,
      isWon: body.isWon || false,
      isLost: body.isLost || false,
    },
  });

  return NextResponse.json(stage, { status: 201 });
}
