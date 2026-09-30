import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { catchUpSchema } from "@/lib/validators/workflow";
import { canCatchUpWorkflow } from "@/lib/workflows/access";
import { CatchUpError, runCatchUp } from "@/lib/workflows/catch-up";
import { jobScopeFor } from "@/lib/workflows/visibility";

/**
 * Complete a phase's open steps in one action. `dryRun` returns what would
 * happen — which steps complete, which are held and why — and writes nothing.
 * Office roles and the job's project manager.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, catchUpSchema);
  if (!parsed.ok) return parsed.response;
  const scope = await jobScopeFor(id);
  if (!scope) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!canCatchUpWorkflow(session.user, scope)) return forbidden();
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { jobId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This job has no workflow yet" }, { status: 404 });
  try {
    return NextResponse.json(await runCatchUp({ instanceId: instance.id, ...parsed.data, actor: session.user }));
  } catch (err) {
    if (err instanceof CatchUpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
