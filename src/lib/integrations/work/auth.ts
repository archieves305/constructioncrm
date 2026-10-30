import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Validates the Authorization header against WORK_API_KEY. Returns null on
// success; otherwise the response to send back. 503 = operator
// misconfiguration (no key), 401 = caller problem. Same shape as
// verifyCcAllocatorAuth, but compared in constant time.
export function verifyWorkAuth(request: NextRequest): NextResponse | null {
  const expected = env.WORK_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "WORK_API_KEY not configured on server" }, { status: 503 });
  }
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
