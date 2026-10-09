import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardSheet } from "@/lib/takeoff/route-guards";
import { calibrateSheet } from "@/lib/takeoff/takeoff-service";
import { calibrateSchema } from "@/lib/takeoff/validation";

/** Calibrate a sheet: auto (check the printed scale against the drawn dimensions), confirm, manual (two points + a distance), clear. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, calibrateSchema);
  if (!body.ok) return body.response;
  const result = await calibrateSheet(id, body.data, session.user.id);
  if (!result) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
  if ("error" in result) return NextResponse.json({ error: result.error, verification: result.verification ?? null }, { status: 400 });
  return NextResponse.json(result);
}
