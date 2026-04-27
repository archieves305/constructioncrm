import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/validation/body";
import { logger } from "@/lib/logger";

const TOKEN_TTL_MINUTES = 30;

const schema = z.object({
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
});

export async function POST(request: NextRequest) {
  const ipLimited = enforceRateLimit(request, {
    name: "auth.forgot.ip",
    limit: 5,
    windowMs: 60_000,
  });
  if (ipLimited) return ipLimited;

  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;
  const email = v.data.email ?? "";

  if (!email) {
    return NextResponse.json({ ok: true });
  }

  const emailLimited = enforceRateLimit(request, {
    name: "auth.forgot.email",
    limit: 3,
    windowMs: 15 * 60_000,
    identifier: email,
  });
  if (emailLimited) return emailLimited;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, email: true, isActive: true },
  });

  if (user?.isActive) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
      },
    });

    const resetUrl = `${env.NEXTAUTH_URL}/reset-password?token=${rawToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your Knu Construction password",
        html: `<p>Hi ${user.firstName},</p>
<p>Click the link below to reset your password. This link expires in ${TOKEN_TTL_MINUTES} minutes.</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>If you didn't request this, ignore this email.</p>`,
        text: `Reset your password: ${resetUrl}\nExpires in ${TOKEN_TTL_MINUTES} minutes.`,
      });
    } catch (err) {
      logger.exception(err, { where: "forgot-password.sendEmail", userId: user.id });
    }
  }

  return NextResponse.json({ ok: true });
}
