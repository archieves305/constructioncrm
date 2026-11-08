import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { env } from "@/lib/env";
import type { BootstrapResponse } from "@/lib/mobile-api";
import { deviceForToken } from "@/lib/mobile/device-service";

/** Builds below this are asked to update. Raised with breaking API changes. */
const DEFAULT_MIN_APP_VERSION = "0.1.0";

/**
 * GET /api/mobile/bootstrap — what the phone app reads when it starts: who is
 * signed in, the minimum app version, and this phone's registration. Sends
 * `X-App-Version` so the registry keeps the installed version.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  const appVersion = req.headers.get("x-app-version");
  const device =
    session.auth?.via === "bearer" && session.auth.tokenHash
      ? await deviceForToken(
          session.auth.tokenHash,
          appVersion && /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(appVersion) ? appVersion : null,
        )
      : null;

  const body: BootstrapResponse = {
    user: session.user,
    minAppVersion: env.MOBILE_MIN_APP_VERSION ?? DEFAULT_MIN_APP_VERSION,
    device,
    serverTime: new Date().toISOString(),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
