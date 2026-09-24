import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { reconcileChangeSchema } from "@/lib/validators/workflow";
import { canApplyWorkflow, canSetPermitStatus } from "@/lib/workflows/access";
import { jobScopeFor } from "@/lib/workflows/visibility";
import { previewReconcile, ReconcileError } from "@/lib/workflows/reconcile";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, reconcileChangeSchema);
  if (!parsed.ok) return parsed.response;
  const jobScope = await jobScopeFor(id);
  if (!jobScope) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const allowed = parsed.data.kind === "permit" ? canSetPermitStatus(session.user, jobScope) : canApplyWorkflow(session.user.role);
  if (!allowed) return forbidden();
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { jobId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This job has no workflow yet" }, { status: 404 });
  try {
    return NextResponse.json(await previewReconcile(instance.id, parsed.data));
  } catch (err) {
    if (err instanceof ReconcileError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
