import { NextResponse } from "next/server";
import { logoutUrl } from "@/lib/sso";

// GET /api/auth/sign-out — bounce to the CareyOS logout.
//
// Exists so the client never needs to know the portal's URL: it lives in
// CAREYOS_SSO_URL, server-side. Ending the session is the portal's job — the
// `careyos_session` cookie is scoped to .careyos.com and shared by every fleet
// app, so signing out here signs the user out everywhere. That is intended.
export async function GET() {
  return NextResponse.redirect(logoutUrl());
}
