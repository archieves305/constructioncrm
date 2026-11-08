import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { clientIp } from "@/lib/rate-limit";
import { canManageMobileDevices, revokeRequest } from "@/lib/mobile/devices";
import { revokeDevice } from "@/lib/mobile/device-service";

type Context = { params: Promise<{ id: string }> };

/** POST /api/admin/mobile-devices/[id]/revoke — switch a phone off (a reason is required; audited). */
export async function POST(req: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageMobileDevices(session.user.role)) return forbidden();
  const { id } = await context.params;
  const v = await validateBody(req, revokeRequest);
  if (!v.ok) return v.response;

  const result = await revokeDevice(id, session.user.id, v.data.reason, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) {
    return result.code === "not_found"
      ? NextResponse.json({ error: "Phone not found", code: "not_found" }, { status: 404 })
      : NextResponse.json({ error: "This phone is already signed out", code: "already_revoked" }, { status: 409 });
  }
  return NextResponse.json({ device: result.device });
}
