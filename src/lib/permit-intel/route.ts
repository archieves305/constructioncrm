import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { guardJob } from "@/lib/access/records";
import type { SessionUser } from "@/lib/auth/helpers";
import { PermitError } from "@/lib/permits/service";
import { PermitIntelError } from "./service";

/**
 * Route plumbing shared by the permit routes: a permit is reached through its
 * job's guard (a sales rep or crew lead only on their own jobs — anything
 * else is a 404), and the service errors become answers.
 */
export async function permitInScope(user: SessionUser, permitId: string, mode: "read" | "write") {
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { id: true, jobId: true, assignedUserId: true } });
  if (!permit) return { permit: null, denied: NextResponse.json({ error: "Permit not found" }, { status: 404 }) } as const;
  const denied = await guardJob(user, permit.jobId, mode);
  return denied ? ({ permit: null, denied } as const) : ({ permit, denied: null } as const);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof PermitIntelError || err instanceof PermitError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}

export const actorOf = (u: SessionUser) => ({ id: u.id, role: u.role, name: `${u.firstName} ${u.lastName}`.trim() || u.email });
