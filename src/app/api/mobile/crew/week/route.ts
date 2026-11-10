import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { loadCrewWeek } from "@/lib/crews/crew-view";
import { isDayKey, todayKey } from "@/lib/time/zone";

/**
 * GET /api/mobile/crew/week?from=yyyy-MM-dd — seven days of install days on
 * the jobs the signed-in person is on, with start times and their answers.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "READ_ONLY") return forbidden();
  const param = request.nextUrl.searchParams.get("from");
  const from = isDayKey(param) ? param : todayKey();
  return NextResponse.json(await loadCrewWeek(session.user, from));
}
