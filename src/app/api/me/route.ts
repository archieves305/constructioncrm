import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/helpers";

// GET /api/me — the current session, for client components.
//
// Under NextAuth the browser read the session from /api/auth/session via
// useSession(). SSO has no such endpoint (the token is the portal's opaque
// cookie and only the server may introspect it), so this is its replacement.
// Returns the same { user } shape the client already expects.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { user: null },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(session, {
    headers: { "Cache-Control": "no-store" },
  });
}
