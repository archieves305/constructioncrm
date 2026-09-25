import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { updateCaseSchema } from "@/lib/validators/violation";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";
import { updateCase } from "@/lib/violations/update";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  try {
    const data = await readCase(id, session.user);
    if (!data) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}

/** Header edits. Reassigning the case manager additionally needs assign rights. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, updateCaseSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canEdit);
  if ("response" in gate) return gate.response;
  if (parsed.data.caseManagerId !== undefined && !gate.permissions.canAssign) return forbidden();
  try {
    await updateCase(id, parsed.data, session.user);
    return NextResponse.json(await readCase(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
