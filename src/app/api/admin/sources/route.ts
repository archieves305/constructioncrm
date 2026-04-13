import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const sources = await prisma.leadSource.findMany({
    include: { children: true },
    where: { parentId: null },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(sources);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "MANAGER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.name) return badRequest("name is required");

  const source = await prisma.leadSource.create({
    data: {
      name: body.name,
      channelType: body.channelType || "OTHER",
      parentId: body.parentId || null,
    },
  });

  return NextResponse.json(source, { status: 201 });
}
