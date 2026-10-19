import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { SessionUser } from "@/lib/auth/helpers";
import { permitInScope } from "./route";

/** A preflight run, reached through its permit (and so its job's guard). */
export async function runInScope(user: SessionUser, runId: string, mode: "read" | "write") {
  const row = await prisma.permitPreflightRun.findUnique({ where: { id: runId }, select: { permitId: true } });
  if (!row) return { permit: null, denied: NextResponse.json({ error: "Preflight run not found" }, { status: 404 }) } as const;
  return permitInScope(user, row.permitId, mode);
}
