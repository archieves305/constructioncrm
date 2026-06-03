import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { zylowClient } from "@/lib/services/zylow/client";
import { zylowErrorResponse } from "@/lib/services/zylow/http";

// Healthcheck for the Zylow integration — verifies the key works without
// touching property data. Useful for an admin status panel.
export async function GET() {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  try {
    const whoami = await zylowClient.whoami();
    return NextResponse.json(whoami);
  } catch (err) {
    return zylowErrorResponse(err, { route: "zylow/whoami" });
  }
}
