import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { RoleName } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth/helpers";
import { logger } from "@/lib/logger";
import { inspectorEnabled, InspectorError } from "./service";

/**
 * The prelude of every inspector route: a signed-in person and the feature
 * switched on (off answers 404, as if the routes were not there). What the
 * person may do with a record is checked in the service (`scopeFor` →
 * `inspectionRights`).
 */
export async function guardInspector(): Promise<{ viewer: { id: string; role: RoleName } } | { response: NextResponse }> {
  if (!inspectorEnabled()) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const session = await getSession();
  if (!session?.user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { viewer: { id: session.user.id, role: session.user.role as RoleName } };
}

/** An InspectorError as its answer; anything else is logged and a 500. */
export function inspectorFailure(err: unknown, where: string): NextResponse {
  if (err instanceof InspectorError) return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
  if (err instanceof ZodError) return NextResponse.json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  logger.exception(err, { where });
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
