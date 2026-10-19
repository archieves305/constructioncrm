import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { assistItemBytes } from "@/lib/permit-intel/assist-run";
import { errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** A document the assistant fetched, to look at before accepting it. PDFs and pictures only, opened in a tab of its own. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const row = await prisma.permitAssistItem.findUnique({ where: { id }, select: { permitId: true } });
  if (!row) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const scope = await permitInScope(session.user, row.permitId, "read");
  if (scope.denied) return scope.denied;
  try {
    const f = await assistItemBytes(id);
    return new NextResponse(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": f.type,
        "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ()]+/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
