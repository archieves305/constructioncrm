import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardTakeoff } from "@/lib/takeoff/route-guards";
import { setTakeoffSheets } from "@/lib/takeoff/takeoff-service";
import { setTakeoffSheetsSchema } from "@/lib/takeoff/validation";

/** Replace which sheets this takeoff draws on (relevant-sheet selection). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, setTakeoffSheetsSchema);
  if (!body.ok) return body.response;
  const result = await setTakeoffSheets(id, body.data.sheets, session.user.id);
  if (!result) return NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
  if ("error" in result) return badRequest(result.error);
  return NextResponse.json(result);
}
