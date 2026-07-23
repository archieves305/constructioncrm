import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/action") ||
    pathname.startsWith("/co") ||
    pathname.startsWith("/api/co") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/track") ||
    // Recipients click this straight from an email, with no session — and
    // Gmail's List-Unsubscribe-Post sends a POST here. The route verifies its
    // own HMAC token and rate-limits itself.
    pathname.startsWith("/api/email/unsubscribe") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/integrations") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request });

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes
  if (pathname.startsWith("/admin")) {
    const role = token.role as string;
    if (role !== "ADMIN" && role !== "MANAGER") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Crew leads live in field mode: keep them off office pages entirely.
  // API routes enforce their own role checks.
  if (
    (token.role as string) === "CREW_LEAD" &&
    !pathname.startsWith("/field") &&
    !pathname.startsWith("/api")
  ) {
    return NextResponse.redirect(new URL("/field", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
