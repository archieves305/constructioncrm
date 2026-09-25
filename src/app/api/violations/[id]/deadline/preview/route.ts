import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { parseDueAt } from "@/lib/tasks/dates";
import { validateBody } from "@/lib/validation/body";
import { deadlineChangeSchema } from "@/lib/validators/violation";
import { previewDeadlineChange } from "@/lib/violations/deadline";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, deadlineChangeSchema.pick({ newDeadline: true }).extend({ kind: deadlineChangeSchema.shape.kind.optional(), reason: deadlineChangeSchema.shape.reason.optional(), reference: deadlineChangeSchema.shape.reference }));
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canChangeDeadline);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await previewDeadlineChange(id, parseDueAt(parsed.data.newDeadline)));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
