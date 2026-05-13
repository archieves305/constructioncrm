import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Shared secret Zapier presents on inbound callback. 503 vs 401 mirrors
// the cc-allocator pattern: missing env is operator misconfiguration,
// wrong/missing header is a caller problem.
export function verifyZapierAuth(request: NextRequest): NextResponse | null {
  const expected = env.ZAPIER_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "ZAPIER_WEBHOOK_SECRET not configured on server" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-zapier-secret") || "";
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
