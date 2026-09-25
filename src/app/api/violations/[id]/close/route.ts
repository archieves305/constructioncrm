import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { closeCaseSchema } from "@/lib/validators/violation";
import { closeCase, computeClosureBlockers } from "@/lib/violations/close";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** Close with every blocker clear, or with an ADMIN/MANAGER override reason. GET returns the blockers. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const gate = await requireCase(id, session.user);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json({ blockers: await computeClosureBlockers(id) });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, closeCaseSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canClose);
  if ("response" in gate) return gate.response;
  if (parsed.data.override && !gate.permissions.canOverrideClosure) return forbidden();
  try {
    const r = await closeCase({ caseId: id, actor: session.user, reason: parsed.data.reason ?? null, overrideReason: parsed.data.override?.reason ?? null, source: "manual" });
    return NextResponse.json({ ...(await readCase(id, session.user)), result: { skippedTasks: r.skippedTasks, overridden: r.overridden } });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
