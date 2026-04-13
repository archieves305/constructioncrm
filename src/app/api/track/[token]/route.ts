import { NextRequest, NextResponse } from "next/server";
import { resolveTrackedLink } from "@/lib/services/tracking/tracked-links";

/**
 * GET /api/track/:token — Resolve tracked action link
 * Redirects to the mobile quick-action page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
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
