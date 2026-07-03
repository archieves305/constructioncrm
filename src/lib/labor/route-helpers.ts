import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { isIsoDate } from "./dates";
import { resolveJobFieldAccess, type FieldAccess } from "./permissions";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export type FieldRouteContext = {
  session: Session;
  access: FieldAccess;
};

/**
 * Shared prelude for job-scoped field routes: session → job existence →
 * field-access level. Returns a NextResponse to short-circuit with, or the
 * resolved context.
 */
export async function requireJobFieldAccess(
  jobId: string,
  min: "read" | "write",
): Promise<FieldRouteContext | { response: NextResponse }> {
  const session = await getSession();
  if (!session?.user) return { response: unauthorized() };

  const { job, access } = await resolveJobFieldAccess(
    { id: session.user.id, role: session.user.role },
    jobId,
  );
  if (!job) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (access === "none" || (min === "write" && access !== "write")) {
    return { response: forbidden() };
  }
  return { session, access };
}

export function validateDateParam(date: string): NextResponse | null {
  return isIsoDate(date) ? null : badRequest("Invalid date — expected YYYY-MM-DD");
}
