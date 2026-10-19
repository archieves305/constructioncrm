import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { deleteParty, updateParty } from "@/lib/permit-intel/service";
import { partySchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

async function scoped(userId: Parameters<typeof permitInScope>[0], partyId: string) {
  const party = await prisma.permitParty.findUnique({ where: { id: partyId }, select: { permitId: true } });
  if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });
  const scope = await permitInScope(userId, party.permitId, "write");
  return scope.denied;
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await scoped(session.user, id);
  if (denied) return denied;
  const v = await validateBody(request, partySchema.partial());
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await updateParty(id, v.data, actorOf(session.user)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const denied = await scoped(session.user, id);
  if (denied) return denied;
  try {
    await deleteParty(id, actorOf(session.user));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
