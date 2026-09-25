import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { agencyConfirmSchema } from "@/lib/validators/violation";
import { confirmAgency } from "@/lib/violations/close";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** The agency's written compliance confirmation. ADMIN/MANAGER only — it is the closure precondition. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, agencyConfirmSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canConfirmAgency);
  if ("response" in gate) return gate.response;
  try {
    await confirmAgency(id, parsed.data, session.user, "manual");
    return NextResponse.json(await readCase(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
