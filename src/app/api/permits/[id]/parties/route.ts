import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { addParty } from "@/lib/permit-intel/service";
import { partySchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Add someone to the permit application: owner, qualifier, architect, engineer, sub. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  const v = await validateBody(request, partySchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await addParty(id, v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
