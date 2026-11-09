import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { markOpened } from "@/lib/guest/service";

/** POST /api/g/[token]/opened — the guest page says it was opened (public; a no-op for a bad code). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(request, { name: "guest-open", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { token } = await params;
  await markOpened(token).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
