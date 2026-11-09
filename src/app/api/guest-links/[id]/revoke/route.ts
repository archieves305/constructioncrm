import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { GuestError, revokeLink } from "@/lib/guest/service";

/** POST /api/guest-links/[id]/revoke — the link stops working (checked by canRunGuestLinks in the service). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  try {
    await revokeLink(session.user, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
