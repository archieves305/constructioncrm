import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { publishTemplate } from "@/lib/permit-intel/forms";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** Publish a draft: it becomes the form used on permits; an older version of the same file is retired. */
export async function POST(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const out = await publishTemplate(id, actorOf(session.user));
    return NextResponse.json(out ?? { ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
