import { NextRequest, NextResponse } from "next/server";
import { processPendingFollowUps } from "@/lib/follow-ups/processor";
import { env } from "@/lib/env";

export async function POST(request: NextRequest) {
  const secret = env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 503 },
    );
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await processPendingFollowUps(100);
  return NextResponse.json(result);
}
