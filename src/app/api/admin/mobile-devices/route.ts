import { NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canManageMobileDevices } from "@/lib/mobile/devices";
import { listDevices } from "@/lib/mobile/device-service";

/** GET /api/admin/mobile-devices — every phone signed in to the app. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageMobileDevices(session.user.role)) return forbidden();
  return NextResponse.json({ devices: await listDevices() });
}
