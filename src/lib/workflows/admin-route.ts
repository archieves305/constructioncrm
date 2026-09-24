import { NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import type { SessionUser } from "@/lib/auth/helpers";
import { canManageTemplates, canViewTemplates } from "./access";
import { VersioningError } from "./versioning";

/** Shared guard + error mapping for the template-editor routes. */
export async function templateActor(mode: "view" | "manage"): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const session = await getSession();
  if (!session?.user) return { response: unauthorized() };
  const ok = mode === "view" ? canViewTemplates(session.user.role) : canManageTemplates(session.user.role);
  if (!ok) return { response: forbidden() };
  return { user: session.user };
}

export function versioningErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof VersioningError) return NextResponse.json({ error: err.message }, { status: err.status });
  return null;
}
