import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { raiseVendorAlerts } from "@/lib/vendors/alert-run";

/**
 * Daily sweep of vendor documents. Raises an ordinary task for the compliance
 * owner when a certificate, exemption or license is inside 30 days of its
 * expiry, and another once it has lapsed (`lib/vendors/alert-run.ts`). Each is
 * raised once, so running this every day never repeats one.
 */
export async function POST(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return NextResponse.json(await raiseVendorAlerts());
}
