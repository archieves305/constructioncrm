import { isCrewRole } from "@/lib/access/roles";
import { NextRequest, NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { listSubmissions } from "@/lib/guest/service";

/**
 * GET /api/guest-submissions?status=PENDING|ALL&jobId= — crew submissions to
 * review: every job for the office roles, their own jobs for a project manager.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "READ_ONLY" || session.user.role === "MARKETING" || isCrewRole(session.user.role)) return forbidden();
  const status = request.nextUrl.searchParams.get("status") === "ALL" ? "ALL" : "PENDING";
  const jobId = request.nextUrl.searchParams.get("jobId") ?? undefined;
  return NextResponse.json(await listSubmissions(session.user, status, jobId));
}
