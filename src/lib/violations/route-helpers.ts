import { NextResponse } from "next/server";
import { casePermissions, type CasePermissions, type CaseScope, type ViolationActor } from "./access";
import { ViolationError } from "./errors";
import { caseScopeFor } from "./scope";

/**
 * What every case route does first: load who is on the case, check the
 * viewer may see it, and hand back the permission set. `check` narrows to
 * one capability; a failed check is a 403, a missing case a 404.
 */
export async function requireCase(
  caseId: string,
  user: ViolationActor,
  check?: (p: CasePermissions) => boolean,
): Promise<{ scope: CaseScope; permissions: CasePermissions } | { response: NextResponse }> {
  const scope = await caseScopeFor(caseId);
  if (!scope) return { response: NextResponse.json({ error: "Case not found" }, { status: 404 }) };
  const permissions = casePermissions(user, scope);
  if (!permissions.canView) return { response: NextResponse.json({ error: "Case not found" }, { status: 404 }) };
  if (check && !check(permissions)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { scope, permissions };
}

export function violationErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof ViolationError) return NextResponse.json({ error: err.message, ...(err.detail && typeof err.detail === "object" ? (err.detail as Record<string, unknown>) : {}) }, { status: err.status });
  return null;
}
