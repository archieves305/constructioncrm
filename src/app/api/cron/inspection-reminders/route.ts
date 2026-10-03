import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { raiseInspectionAlerts } from "@/lib/permits/alert-run";

/**
 * Daily, on working days: a "be ready" task for every booked inspection up
 * to the next working day (a Friday run covers the weekend and Monday), for
 * the superintendent, else the project manager. Raised once per inspection
 * date; it closes itself when the result is recorded or the date moves.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return NextResponse.json(await raiseInspectionAlerts());
}
