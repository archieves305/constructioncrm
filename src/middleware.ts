import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge gate.
 *
 * Middleware only answers "is there a session cookie at all?". It deliberately
 * does not introspect the portal or check roles: that would put a network call
 * on every request, and the edge runtime has no database access to resolve the
 * CRM user anyway.
 *
 * Real enforcement is server-side and unchanged in strength:
 *   - route handlers call requireSession()/requireRole() (src/lib/auth/helpers)
 *   - the (dashboard), (dashboard)/admin and (field) layouts gate by role
 * Both resolve the live SSO answer, so a revoked grant is refused there even
 * though a stale cookie gets past this check.
 */

const SESSION_COOKIE = "careyos_session";

// Reachable with no session: customer token links, machine callers, and the
// login bounce itself. A regression here is silent — the caller gets a redirect
// to the portal instead of the endpoint — so it is covered by middleware.test.ts.
const PUBLIC_PREFIXES = [
  "/login",
  "/action",
  "/co",
  "/api/co",
  "/api/auth",
  "/api/track",
  "/api/email/unsubscribe",
  "/api/cron",
  "/api/integrations",
  "/_next",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/favicon.ico" ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.redirect(portalLogin(request));
  }

  return NextResponse.next();
}

/**
 * Send the user to the portal, asking it to return them where they were going.
 * Read from process.env directly rather than importing src/lib/env: that module
 * validates the whole environment at import time, which is more than the edge
 * bundle should be carrying. Defaults match env.ts.
 */
function portalLogin(request: NextRequest): string {
  const sso = (process.env.CAREYOS_SSO_URL ?? "https://app.careyos.com").replace(
    /\/$/,
    "",
  );
  const appBase = (
    process.env.APP_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    request.nextUrl.origin
  ).replace(/\/$/, "");
  const next = `${appBase}${request.nextUrl.pathname}${request.nextUrl.search}`;
  return `${sso}/login?next=${encodeURIComponent(next)}`;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
