import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { finalizeProblems, planFill, summarize, type FieldMap } from "@/lib/permit-intel/field-fill";
import { loadFormContext } from "@/lib/permit-intel/fills";
import { inventoryOf } from "@/lib/permit-intel/forms";
import { errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** What the form would hold for a permit, with the mapping as it stands. Writes nothing. */
export async function GET(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePermitSettings(session.user.role)) return forbidden();
  const permitId = request.nextUrl.searchParams.get("permitId");
  if (!permitId) return badRequest("permitId is required");
  const scope = await permitInScope(session.user, permitId, "read");
  if (scope.denied) return scope.denied;
  const { id } = await params;
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { fieldInventory: true, fields: { select: { fieldName: true, dataKey: true, transform: true } } } });
  if (!t) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  try {
    const values = planFill(inventoryOf(t), t.fields as FieldMap[], await loadFormContext(permitId), {});
    return NextResponse.json({ values, summary: summarize(values), problems: finalizeProblems(values) });
  } catch (err) {
    return errorResponse(err);
  }
}
