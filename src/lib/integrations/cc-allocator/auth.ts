import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Validates the Authorization header against CC_ALLOCATOR_API_KEY.
// Returns null on success; otherwise the response to send back.
//
// 503 vs 401 distinction: missing env is an operator misconfiguration,
// missing/wrong header is a caller problem. Mirrors the pattern in
// src/app/api/cron/follow-ups/route.ts.
export function verifyCcAllocatorAuth(
  request: NextRequest,
): NextResponse | null {
  const expected = env.CC_ALLOCATOR_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "CC_ALLOCATOR_API_KEY not configured on server" },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
