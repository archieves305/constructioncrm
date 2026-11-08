import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { isExpoPushToken } from "@/lib/mobile/push";
import { setPushToken } from "@/lib/mobile/push-send";

const schema = z.object({
  pushToken: z.string().nullable().refine((v) => v === null || isExpoPushToken(v), "Not an Expo push token"),
});

/**
 * PUT /api/mobile/devices/current/push — this phone's Expo push token, or
 * null to stop pushes to it. Only the phone app's own sign-in can set it.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const tokenHash = session.auth?.via === "bearer" ? session.auth.tokenHash : undefined;
  if (!tokenHash) {
    return NextResponse.json({ error: "Set push from the phone app", code: "bearer_required" }, { status: 400 });
  }
  const v = await validateBody(req, schema);
  if (!v.ok) return v.response;
  const ok = await setPushToken(tokenHash, v.data.pushToken);
  if (!ok) {
    return NextResponse.json({ error: "Register this phone first", code: "device_not_registered" }, { status: 409 });
  }
  return new NextResponse(null, { status: 204 });
}
