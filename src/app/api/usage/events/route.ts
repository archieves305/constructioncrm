import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { usageBatchSchema } from "@/lib/usage/events";
import { recordUsage } from "@/lib/usage/record";
import { validateBody } from "@/lib/validation/body";

/**
 * POST /api/usage/events — a batch of the signed-in person's own usage events
 * (what they opened, from the phone or the web). Only known event names and
 * record kinds are stored; nothing identifies a record or its content.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const limited = enforceRateLimit(request, { name: "usage", identifier: session.user.id, limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const v = await validateBody(request, usageBatchSchema);
  if (!v.ok) return v.response;
  const stored = await recordUsage(session.user.id, v.data.source, v.data.events);
  return NextResponse.json({ stored });
}
