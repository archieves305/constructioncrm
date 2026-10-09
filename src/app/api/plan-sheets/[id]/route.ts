import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { guardSheet } from "@/lib/takeoff/route-guards";
import { getSheet, updateSheet } from "@/lib/takeoff/service";
import { patchSheetSchema } from "@/lib/takeoff/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "read");
  if (denied) return denied;
  const sheet = await getSheet(id);
  return sheet ? NextResponse.json(sheet) : NextResponse.json({ error: "Sheet not found" }, { status: 404 });
}

/** A person's correction of the sheet's number, title, discipline, scale, revision or what supersedes it. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await guardSheet(session.user, id, "write");
  if (denied) return denied;
  const body = await validateBody(request, patchSheetSchema);
  if (!body.ok) return body.response;
  const updated = await updateSheet(id, body.data, session.user.id);
  if (!updated) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
  if ("error" in updated) return badRequest(updated.error);
  return NextResponse.json(updated);
}
