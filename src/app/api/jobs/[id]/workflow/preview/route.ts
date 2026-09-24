import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { applyWorkflowSchema } from "@/lib/validators/workflow";
import { canApplyWorkflow } from "@/lib/workflows/access";
import { previewWorkflow, WorkflowApplyError } from "@/lib/workflows/apply";
import { parseDueAt } from "@/lib/tasks/dates";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canApplyWorkflow(session.user.role)) return forbidden();
  const { id } = await params;

  const parsed = await validateBody(request, applyWorkflowSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  try {
    const preview = await previewWorkflow({
      jobId: id,
      templateKeys: b.templateKeys,
      permitStatus: b.permitStatus,
      scopeToggles: b.scopeToggles,
      team: b.team,
      targetStartDate: b.targetStartDate === undefined ? undefined : b.targetStartDate ? parseDueAt(b.targetStartDate) : null,
      jurisdiction: b.jurisdiction,
      permit: b.permit,
      actor: session.user,
    });
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof WorkflowApplyError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
