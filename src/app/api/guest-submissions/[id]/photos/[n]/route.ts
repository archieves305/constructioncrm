import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { readFile } from "@/lib/files/storage";
import { GuestError, submissionPhoto } from "@/lib/guest/service";

/** GET /api/guest-submissions/[id]/photos/[n] — a photo waiting for review (checked by canRunGuestLinks in the service). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, n } = await params;
  try {
    const p = await submissionPhoto(session.user, id, Number(n));
    const data = await readFile(p.key);
    const ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);
    return new NextResponse(ab, { headers: { "Content-Type": p.type, "Content-Length": String(data.byteLength), "Cache-Control": "private, max-age=0, no-store" } });
  } catch (err) {
    if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Missing on disk" }, { status: 410 });
  }
}
