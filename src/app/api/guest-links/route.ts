import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { GUEST_PURPOSES } from "@/lib/guest/purposes";
import { createGuestLink, GuestError, linksForJob } from "@/lib/guest/service";
import { validateBody } from "@/lib/validation/body";

const createSchema = z.object({
  purpose: z.enum(GUEST_PURPOSES),
  laborContractId: z.string().max(60).optional(),
  crewAssignmentId: z.string().max(60).optional(),
});

/** POST /api/guest-links — make a crew link (office roles and the job's PM; checked in the service by canRunGuestLinks). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const v = await validateBody(request, createSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await createGuestLink(session.user, v.data), { status: 201 });
  } catch (err) {
    if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** GET /api/guest-links?jobId= — a job's crew links and how far each got. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  try {
    return NextResponse.json(await linksForJob(session.user, jobId));
  } catch (err) {
    if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
