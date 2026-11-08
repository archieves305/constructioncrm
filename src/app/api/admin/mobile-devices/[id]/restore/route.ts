import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { clientIp } from "@/lib/rate-limit";
import { canManageMobileDevices } from "@/lib/mobile/devices";
import { restoreDevice } from "@/lib/mobile/device-service";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/mobile-devices/[id]/restore — let a revoked phone sign in
 * again. Its old sign-ins stay ended; the person signs in afresh. Audited.
 */
export async function POST(req: NextRequest, context: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageMobileDevices(session.user.role)) return forbidden();
  const { id } = await context.params;

  const result = await restoreDevice(id, session.user.id, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) {
    return result.code === "not_found"
      ? NextResponse.json({ error: "Phone not found", code: "not_found" }, { status: 404 })
      : NextResponse.json({ error: "This phone is not signed out", code: "not_revoked" }, { status: 409 });
  }
  return NextResponse.json({ device: result.device });
}
