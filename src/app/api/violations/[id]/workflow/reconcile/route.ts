import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { reconcileChangeSchema } from "@/lib/validators/workflow";
import { canApplyWorkflow, canSetPermitStatus } from "@/lib/workflows/access";
import { visibilityScopeFor } from "@/lib/workflows/visibility";
import { reconcile, ReconcileError } from "@/lib/workflows/reconcile";
import { readCaseWorkflow } from "@/lib/workflows/read";
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
  const subjectScope = toJobScope(gate.scope);
  const allowed = parsed.data.kind === "permit" ? canSetPermitStatus(session.user, subjectScope) : canApplyWorkflow(session.user.role);
  if (!allowed) return forbidden();
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This case has no workflow yet" }, { status: 404 });
  try {
    const result = await reconcile(instance.id, parsed.data, session.user);
    const data = await readCaseWorkflow(id, session.user, await visibilityScopeFor(session.user), subjectScope);
    return NextResponse.json({ ...data, result });
  } catch (err) {
    if (err instanceof ReconcileError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
