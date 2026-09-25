import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { extensionDecisionSchema } from "@/lib/validators/violation";
import { decideExtension } from "@/lib/violations/deadline";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** Record the agency's decision. Granting moves the current deadline through the deadline-change path. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; extensionId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, extensionId } = await params;
  const parsed = await validateBody(request, extensionDecisionSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canChangeDeadline);
  if ("response" in gate) return gate.response;
  try {
    const r = await decideExtension(id, extensionId, parsed.data, session.user);
    return NextResponse.json({ ...(await readCase(id, session.user)), result: { moved: r.moved } });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
