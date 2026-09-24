import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { processPendingFollowUps } from "@/lib/follow-ups/processor";

export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await processPendingFollowUps(100);
  return NextResponse.json(result);
}
