import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { registerDeviceRequest } from "@/lib/mobile-api";
import { registerDevice } from "@/lib/mobile/device-service";

/**
 * POST /api/mobile/devices — the phone app registers itself after sign-in
 * (and on each start). Only the signed-in person's own phone, and only from
 * the app: a browser session carries no token to tie the phone to.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const tokenHash = session.auth?.via === "bearer" ? session.auth.tokenHash : undefined;
  if (!tokenHash) {
    return NextResponse.json(
      { error: "Register from the phone app", code: "bearer_required" },
      { status: 400 },
    );
  }

  const limited = enforceRateLimit(req, {
    name: "mobile-device-register",
    limit: 20,
    windowMs: 60_000,
    identifier: session.user.id,
  });
  if (limited) return limited;

  const v = await validateBody(req, registerDeviceRequest);
  if (!v.ok) return v.response;

  const result = await registerDevice(session.user.id, tokenHash, v.data, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) {
    return NextResponse.json(
      result.code === "device_revoked"
        ? { error: "This phone was signed out by an administrator", code: "device_revoked" }
        : { error: "This sign-in belongs to another phone", code: "token_taken" },
      { status: 403 },
    );
  }
  return NextResponse.json({ device: result.device }, { status: result.created ? 201 : 200 });
}
