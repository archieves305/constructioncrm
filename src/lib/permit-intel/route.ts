import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { guardJob } from "@/lib/access/records";
import type { SessionUser } from "@/lib/auth/helpers";
import { AiError } from "@/lib/ai/client";
import { jobsInvolvingUserWhere } from "@/lib/jobs/involvement";
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
  if (err instanceof PermitIntelError || err instanceof PermitError || err instanceof AiError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}

export const actorOf = (u: SessionUser) => ({ id: u.id, role: u.role, name: `${u.firstName} ${u.lastName}`.trim() || u.email });
export const mailActorOf = (u: SessionUser) => ({ ...actorOf(u), email: u.email });

/** A correction notice, item or permit message reached through its permit (and so its job's guard). */
export async function noticeInScope(user: SessionUser, noticeId: string, mode: "read" | "write") {
  const row = await prisma.permitCorrectionNotice.findUnique({ where: { id: noticeId }, select: { permitId: true } });
  if (!row) return { permit: null, denied: NextResponse.json({ error: "Notice not found" }, { status: 404 }) } as const;
  return permitInScope(user, row.permitId, mode);
}

export async function itemInScope(user: SessionUser, itemId: string, mode: "read" | "write") {
  const row = await prisma.permitCorrectionItem.findUnique({ where: { id: itemId }, select: { permitId: true } });
  if (!row) return { permit: null, denied: NextResponse.json({ error: "Item not found" }, { status: 404 }) } as const;
  return permitInScope(user, row.permitId, mode);
}

export async function messageInScope(user: SessionUser, messageId: string, mode: "read" | "write") {
  const row = await prisma.permitMessage.findUnique({ where: { id: messageId }, select: { permitId: true } });
  if (!row) return { permit: null, denied: NextResponse.json({ error: "Email not found" }, { status: 404 }) } as const;
  return permitInScope(user, row.permitId, mode);
}

/** Whether the viewer has a role on the job (the "My jobs" rule). */
export async function involvedWithJob(userId: string, jobId: string): Promise<boolean> {
  return (await prisma.job.count({ where: { AND: [{ id: jobId }, jobsInvolvingUserWhere(userId)] } })) > 0;
}

/** AI-starting routes: a few a minute per person is plenty, and a loop costs money. */
export const AI_RATE = { limit: 12, windowMs: 60_000 } as const;
