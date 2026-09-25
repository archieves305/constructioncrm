import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { applyWorkflowSchema } from "@/lib/validators/workflow";
import { canApplyWorkflow } from "@/lib/workflows/access";
import { applyCaseWorkflow } from "@/lib/violations/workflow";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** Apply the (single) violation template. Re-applying the same configuration creates nothing. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApplyWorkflow(session.user.role)) return forbidden();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const parsed = await validateBody(request, applyWorkflowSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  const templateKey = b.templateKeys[0];
  if (!templateKey || b.templateKeys.length !== 1) return NextResponse.json({ error: "A violation case runs exactly one violation workflow template" }, { status: 400 });
  try {
    const result = await applyCaseWorkflow(id, { templateKey, permitStatus: b.permitStatus, scopeToggles: b.scopeToggles[templateKey] ?? {}, team: b.team, jurisdiction: b.jurisdiction, permitNotes: b.permit?.notes ?? null, permitDocumentFileId: b.permit?.documentFileId ?? null }, session.user);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
