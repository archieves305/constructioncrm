import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/validation/body";
import { validatePassword } from "@/lib/auth/password-policy";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, {
    name: "auth.reset",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const { token, password } = v.data;

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, isActive: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
    return NextResponse.json({ error: "invalid or expired token" }, { status: 400 });
  }

  const policy = validatePassword(password, [
    record.user.email,
    record.user.firstName,
    record.user.lastName,
  ]);
  if (!policy.ok) {
    return NextResponse.json(
      { error: policy.reason, suggestions: policy.suggestions },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { userId: record.userId, id: { not: record.id }, usedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
