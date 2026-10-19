import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import { canManagePermitSettings } from "@/lib/permit-intel/access";
import { finalizeProblems, planFill, summarize, type FieldMap } from "@/lib/permit-intel/field-fill";
import { loadFormContext } from "@/lib/permit-intel/fills";
import { inventoryOf, templateBytes } from "@/lib/permit-intel/forms";
import { fillFlatForm, fillForm, outlineFields } from "@/lib/permit-intel/form-pdf";
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
  const t = await prisma.permitFormTemplate.findUnique({ where: { id }, select: { formKind: true, fieldInventory: true, fields: { select: { fieldName: true, dataKey: true, transform: true } } } });
  if (!t) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  try {
    const values = planFill(inventoryOf(t), t.fields as FieldMap[], await loadFormContext(permitId), {});
    // ?pdf=1: the form as it would be written for this permit (nothing stored); &boxes=1 outlines every field
    if (request.nextUrl.searchParams.get("pdf") === "1") {
      const blank = new Uint8Array((await templateBytes(id)).bytes);
      const out = t.formKind === "FLAT" ? await fillFlatForm(blank, values, inventoryOf(t)) : await fillForm(blank, values);
      const pdf = request.nextUrl.searchParams.get("boxes") === "1" ? await outlineFields(out.flattened, inventoryOf(t)) : out.flattened;
      return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="preview.pdf"', "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ values, summary: summarize(values), problems: finalizeProblems(values) });
  } catch (err) {
    return errorResponse(err);
  }
}
