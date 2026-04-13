import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, badRequest } from "@/lib/auth/helpers";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const services = await prisma.serviceCategory.findMany({
    include: { children: true },
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(services);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "MANAGER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.name) return badRequest("name is required");

  const service = await prisma.serviceCategory.create({
    data: {
      name: body.name,
      parentId: body.parentId || null,
      sortOrder: body.sortOrder || 0,
    },
  });

  return NextResponse.json(service, { status: 201 });
}
