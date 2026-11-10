import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { loadCrewToday } from "@/lib/crews/crew-view";
import { isDayKey, todayKey } from "@/lib/time/zone";

/**
 * GET /api/mobile/crew/today?date=yyyy-MM-dd — the crew mode's Today: the open
 * jobs the signed-in person is on, with no money and no customer contact
 * (lib/crews/crew-view.ts). Any signed-in role but READ_ONLY may ask; each
 * sees only their own jobs.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "READ_ONLY") return forbidden();
  const param = request.nextUrl.searchParams.get("date");
  const day = isDayKey(param) ? param : todayKey();
  return NextResponse.json(await loadCrewToday(session.user, day));
}
