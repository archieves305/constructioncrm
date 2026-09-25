import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { reconcileChangeSchema } from "@/lib/validators/workflow";
import { canApplyWorkflow, canSetPermitStatus } from "@/lib/workflows/access";
import { previewReconcile, ReconcileError } from "@/lib/workflows/reconcile";
import { toJobScope } from "@/lib/violations/access";
import { requireCase } from "@/lib/violations/route-helpers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, reconcileChangeSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  const allowed = parsed.data.kind === "permit" ? canSetPermitStatus(session.user, toJobScope(gate.scope)) : canApplyWorkflow(session.user.role);
  if (!allowed) return forbidden();
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This case has no workflow yet" }, { status: 404 });
  try {
    return NextResponse.json(await previewReconcile(instance.id, parsed.data));
  } catch (err) {
    if (err instanceof ReconcileError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
