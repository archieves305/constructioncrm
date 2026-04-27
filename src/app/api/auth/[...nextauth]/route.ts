import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { enforceRateLimit } from "@/lib/rate-limit";

const handler = NextAuth(authOptions);

export const GET = handler;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ nextauth: string[] }> },
) {
  if (req.nextUrl.pathname.endsWith("/callback/credentials")) {
    const limited = enforceRateLimit(req, {
      name: "auth.login",
      limit: 10,
      windowMs: 60_000,
    });
    if (limited) return limited;
  }
  return (handler as unknown as (req: NextRequest, ctx: unknown) => Promise<Response>)(req, ctx);
}
