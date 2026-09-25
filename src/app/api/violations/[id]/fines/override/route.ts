import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { fineOverrideSchema } from "@/lib/validators/violation";
import { setFineOverride } from "@/lib/violations/fine-ledger";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** ADMIN/MANAGER: replace (or clear) the system's fine estimate with a reason. The system figure is still shown. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const parsed = await validateBody(request, fineOverrideSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canOverrideFines);
  if ("response" in gate) return gate.response;
  try {
    await setFineOverride(id, parsed.data.amount, parsed.data.reason, session.user);
    return NextResponse.json(await readCase(id, session.user));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
