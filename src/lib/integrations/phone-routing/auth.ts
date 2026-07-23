import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Validates the Authorization header against PHONE_ROUTING_API_KEY.
// Returns null on success; otherwise the response to send back.
//
// 503 vs 401 distinction: missing env is an operator misconfiguration,
// missing/wrong header is a caller problem. Mirrors verifyCcAllocatorAuth.
export function verifyPhoneRoutingAuth(
  request: NextRequest,
): NextResponse | null {
  const expected = env.PHONE_ROUTING_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "PHONE_ROUTING_API_KEY not configured on server" },
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
