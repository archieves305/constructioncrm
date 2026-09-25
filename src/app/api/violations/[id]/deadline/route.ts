import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { parseDueAt } from "@/lib/tasks/dates";
import { validateBody } from "@/lib/validation/body";
import { deadlineChangeSchema } from "@/lib/validators/violation";
import { changeDeadline } from "@/lib/violations/deadline";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** Move the current compliance deadline; every open step anchored to it moves with it. Preview first. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, deadlineChangeSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canChangeDeadline);
  if ("response" in gate) return gate.response;
  try {
    const r = await changeDeadline({ caseId: id, newDeadline: parseDueAt(parsed.data.newDeadline), kind: parsed.data.kind, reason: parsed.data.reason, reference: parsed.data.reference ?? null, actor: session.user });
    return NextResponse.json({ ...(await readCase(id, session.user)), result: r });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
