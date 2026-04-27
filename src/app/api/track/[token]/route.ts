import { NextRequest, NextResponse } from "next/server";
import { resolveTrackedLink } from "@/lib/services/tracking/tracked-links";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = enforceRateLimit(request, {
    name: "track.resolve",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { token } = await params;

  const result = await resolveTrackedLink(
    token,
    request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
    request.headers.get("user-agent") || undefined
  );

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Redirect to the public action page
  const actionUrl = new URL(`/action/${token}`, request.url);
  return NextResponse.redirect(actionUrl);
}
