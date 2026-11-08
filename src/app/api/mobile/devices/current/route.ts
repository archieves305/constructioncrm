import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { endToken } from "@/lib/mobile/device-service";

/**
 * DELETE /api/mobile/devices/current — sign out on the phone. The token the
 * request carries is refused from now on, even though the portal would still
 * accept it until it expires.
 */
export async function DELETE() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const tokenHash = session.auth?.via === "bearer" ? session.auth.tokenHash : undefined;
  if (!tokenHash) {
    return NextResponse.json(
      { error: "Sign out from the phone app", code: "bearer_required" },
      { status: 400 },
    );
  }
  await endToken(tokenHash);
  return new NextResponse(null, { status: 204 });
}
