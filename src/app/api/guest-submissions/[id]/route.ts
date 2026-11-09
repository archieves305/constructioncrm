import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { decideSubmission, GuestError } from "@/lib/guest/service";
import { validateBody } from "@/lib/validation/body";

const bodySchema = z.object({ decision: z.enum(["accept", "reject"]), note: z.string().trim().max(1000).nullable().optional() });

/** POST /api/guest-submissions/[id] — accept (it takes effect) or reject (photos deleted). Checked by canRunGuestLinks in the service. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;
  if (v.data.decision === "reject" && !v.data.note?.trim()) return NextResponse.json({ error: "Say why it is rejected" }, { status: 400 });
  try {
    return NextResponse.json(await decideSubmission(session.user, id, v.data.decision, v.data.note));
  } catch (err) {
    if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
