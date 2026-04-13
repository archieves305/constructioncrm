import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const crews = await prisma.crew.findMany({
    include: {
      assignments: {
        where: {
          job: { currentStage: { isClosed: false } },
        },
        include: {
          job: { select: { id: true, jobNumber: true, title: true, scheduledDate: true } },
        },
        orderBy: { installDate: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(crews);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.name || !body.tradeType) return badRequest("name and tradeType required");

  const crew = await prisma.crew.create({
    data: { name: body.name, tradeType: body.tradeType },
  });

  return NextResponse.json(crew, { status: 201 });
}
