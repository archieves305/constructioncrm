import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { reviseTemplate } from "@/lib/permit-intel/forms";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Start the next version of a published form, as a draft to edit. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const out = await reviseTemplate(id, actorOf(session.user));
    return NextResponse.json(out ?? { ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
