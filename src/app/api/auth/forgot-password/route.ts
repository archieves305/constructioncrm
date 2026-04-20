import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/send";
import { env } from "@/lib/env";

const TOKEN_TTL_MINUTES = 30;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";

  if (!email) {
    return NextResponse.json({ ok: true });
  }

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
      console.error("[forgot-password] email send failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}
