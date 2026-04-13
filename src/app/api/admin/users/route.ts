import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole, badRequest } from "@/lib/auth/helpers";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    include: { role: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    users.map(({ passwordHash: _pw, ...user }) => user)
  );
}

export async function POST(request: NextRequest) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.email || !body.firstName || !body.lastName || !body.password || !body.roleId) {
    return badRequest("email, firstName, lastName, password, and roleId are required");
  }

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) return badRequest("Email already in use");

  const passwordHash = await bcrypt.hash(body.password, 12);

  const user = await prisma.user.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      passwordHash,
      roleId: body.roleId,
    },
    include: { role: true },
  });

  const { passwordHash: _, ...safeUser } = user;
  return NextResponse.json(safeUser, { status: 201 });
}
