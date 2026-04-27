import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requireRole, badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { validatePassword } from "@/lib/auth/password-policy";

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

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  password: z.string().min(1),
  roleId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const v = await validateBody(request, createUserSchema);
  if (!v.ok) return v.response;
  const { email, firstName, lastName, password, roleId } = v.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return badRequest("Email already in use");

  const policy = validatePassword(password, [email, firstName, lastName]);
  if (!policy.ok) {
    return NextResponse.json(
      { error: policy.reason, suggestions: policy.suggestions },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { firstName, lastName, email, passwordHash, roleId },
    include: { role: true },
  });

  const { passwordHash: _, ...safeUser } = user;
  return NextResponse.json(safeUser, { status: 201 });
}
