import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { hearingCreateSchema } from "@/lib/validators/violation";
import { scheduleHearing } from "@/lib/violations/hearings";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, hearingCreateSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canRecordHearing);
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await scheduleHearing(id, parsed.data, session.user), { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
