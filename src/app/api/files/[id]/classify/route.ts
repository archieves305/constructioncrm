import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canWriteProduction } from "@/lib/access/roles";
import { suggestDocType } from "@/lib/permit-intel/library";
import { AI_RATE, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The AI's suggestion for a permit document's type. Nothing is stored on the file; a person accepts it or not. */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const file = await prisma.file.findUnique({ where: { id }, select: { permitId: true } });
  if (!file?.permitId) return NextResponse.json({ error: "Permit document not found" }, { status: 404 });
  const scope = await permitInScope(session.user, file.permitId, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
  if (limited) return limited;
  try {
    return NextResponse.json(await suggestDocType(id, session.user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
