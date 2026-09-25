import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { createCaseSchema } from "@/lib/validators/violation";
import { canCreateCase } from "@/lib/violations/access";
import { createCase } from "@/lib/violations/create";
import { parseViolationListParams } from "@/lib/violations/query";
import { listCases } from "@/lib/violations/read";
import { violationErrorResponse } from "@/lib/violations/route-helpers";

/** The case list: every queue is a `?view=`, every filter a param, the role scope always applied. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const params = parseViolationListParams(request.nextUrl.searchParams);
  return NextResponse.json(await listCases(params, session.user));
}

/** Intake: case + items (+ first hearing, opening ledger) in one transaction, then the workflow. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canCreateCase(session.user.role)) return forbidden();
  const parsed = await validateBody(request, createCaseSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await createCase(parsed.data, session.user);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
