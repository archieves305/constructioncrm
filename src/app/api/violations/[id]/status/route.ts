import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { caseStatusSchema } from "@/lib/validators/violation";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";
import { changeStatus } from "@/lib/violations/update";

/** Lifecycle moves from the Change-status menu. CLOSED goes through /close; CANCELLED is ADMIN/MANAGER. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, caseStatusSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  if (parsed.data.status === "CLOSED") return NextResponse.json({ error: "Close the case from the Close action" }, { status: 400 });
  if (parsed.data.status === "CANCELLED" && !gate.permissions.canCancel) return forbidden();
  try {
    await changeStatus(id, parsed.data.status, parsed.data.reason ?? null, session.user);
    return NextResponse.json(await readCase(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
