import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { agencyInspectionResultSchema } from "@/lib/validators/violation";
import { recordAgencyInspectionResult } from "@/lib/violations/inspections";
import { readCase } from "@/lib/violations/read";
import { requireCase, violationErrorResponse } from "@/lib/violations/route-helpers";

/** The agency's result. A FAIL reopens the re-cited items and (via the step) blocks the workflow; `confirmsAgency` needs ADMIN/MANAGER. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; inspectionId: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, inspectionId } = await params;
  const parsed = await validateBody(request, agencyInspectionResultSchema);
  if (!parsed.ok) return parsed.response;
  const gate = await requireCase(id, session.user, (p) => p.canRecordInspection);
  if ("response" in gate) return gate.response;
  if (parsed.data.confirmsAgency && !gate.permissions.canConfirmAgency) return forbidden();
  try {
    const r = await recordAgencyInspectionResult(id, inspectionId, parsed.data, session.user);
    return NextResponse.json({ ...(await readCase(id, session.user)), result: r });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
