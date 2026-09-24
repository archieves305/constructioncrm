import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * The shared-secret gate every `/api/cron/*` route sits behind.
 *
 * 503 when the server has no secret (operator misconfiguration — nothing
 * could ever pass), 403 when the caller's header does not match. This block
 * was copy-pasted into eight routes before it lived here.
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
