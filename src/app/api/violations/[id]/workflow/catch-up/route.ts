import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { catchUpSchema } from "@/lib/validators/workflow";
import { canCatchUpWorkflow } from "@/lib/workflows/access";
import { CatchUpError, runCatchUp } from "@/lib/workflows/catch-up";
import { toJobScope } from "@/lib/violations/access";
import { requireCase } from "@/lib/violations/route-helpers";

/** The case twin of the job route: office roles and the case manager. "Close case" is never caught up. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, catchUpSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  if (!canCatchUpWorkflow(session.user, toJobScope(gate.scope))) return forbidden();
  const instance = await prisma.jobWorkflowInstance.findUnique({ where: { violationCaseId: id }, select: { id: true } });
  if (!instance) return NextResponse.json({ error: "This case has no workflow yet" }, { status: 404 });
  try {
    return NextResponse.json(await runCatchUp({ instanceId: instance.id, ...parsed.data, actor: session.user }));
  } catch (err) {
    if (err instanceof CatchUpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
