import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardTakeoff } from "@/lib/takeoff/route-guards";
import { deleteTakeoff, getTakeoff, updateTakeoff } from "@/lib/takeoff/takeoff-service";
import { patchTakeoffSchema } from "@/lib/takeoff/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "read");
  if (denied) return denied;
  const t = await getTakeoff(id);
  return t ? NextResponse.json(t) : NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, patchTakeoffSchema);
  if (!body.ok) return body.response;
  const t = await updateTakeoff(id, body.data, session.user.id);
  return t ? NextResponse.json(t) : NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
}

/** Removes the takeoff and its measurements. ADMIN / MANAGER. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardTakeoff(session.user, id, "delete");
  if (denied) return denied;
  const removed = await deleteTakeoff(id, session.user.id);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Takeoff not found" }, { status: 404 });
}
