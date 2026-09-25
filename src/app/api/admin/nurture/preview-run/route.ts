import { NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { canViewNurture } from "@/lib/nurture/access";
import { runNurtureTick } from "@/lib/nurture/run";

/** POST — a dry run of today's tick from the admin page: what would go to whom, and why not. */
export async function POST() {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewNurture(session.user.role)) return forbidden();
  const result = await runNurtureTick(new Date(), { dryRun: true });
  return NextResponse.json(result);
}
