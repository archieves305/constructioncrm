import { prisma } from "@/lib/db/prisma";
import { createTask } from "@/lib/tasks/create";
import { addWorkingDays } from "@/lib/time/working-days";
import { atLocalTime, todayKey } from "@/lib/time/zone";
import { loadHolidays } from "./holidays";

/**
 * Bid events that raise work. Every raise writes its BidFollowUpAction row
 * first: the (opportunity, slot) key is unique, so a second call — a double
 * click, a retried request — raises nothing.
 */

export const BID_TASK_PREFIX = "bidfu:";
export const bidTaskKey = (bidId: string, slotKey: string) => `${BID_TASK_PREFIX}${bidId}:${slotKey}`;

/** Who works a GC opportunity: its lead's owner (if active), else the project owner, else the person acting. */
export async function opportunityOwnerId(bidId: string, fallbackUserId: string): Promise<string> {
  const b = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { lead: { select: { assignedUser: { select: { id: true, isActive: true } } } }, bidProject: { select: { owner: { select: { id: true, isActive: true } } } } } });
  const lead = b?.lead.assignedUser;
  if (lead?.isActive) return lead.id;
  const proj = b?.bidProject?.owner;
  if (proj?.isActive) return proj.id;
  return fallbackUserId;
}

/** Raise one follow-up action and its task (a half-hour call window from `dueAt`), once per slot. Returns false when the slot was already raised. */
export async function raiseActionTask(input: { bidId: string; slotKey: string; kind: "CALL" | "REVIEW" | "URGENT_CALL"; reason: string; dueAt: Date; title: string; description: string; priority: "MEDIUM" | "HIGH" | "URGENT"; actorUserId: string | null; planInputs?: Record<string, unknown> }): Promise<boolean> {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: input.bidId }, select: { leadId: true, organizationId: true } });
  if (!bid) return false;
  try {
    await prisma.bidFollowUpAction.create({ data: { bidInvitationId: input.bidId, slotKey: input.slotKey, kind: input.kind, reason: input.reason, dueAt: input.dueAt, status: "PLANNED", planInputs: (input.planInputs ?? {}) as object } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
  const owner = await opportunityOwnerId(input.bidId, input.actorUserId ?? "");
  const task = await createTask(
    { title: input.title, description: input.description, priority: input.priority, scheduledStart: input.dueAt, dueAt: new Date(input.dueAt.getTime() + 30 * 60_000), allDay: false, assignedUserId: owner || null, createdByUserId: owner || input.actorUserId || "", leadId: bid.leadId, source: "auto", sourceKey: bidTaskKey(input.bidId, input.slotKey) },
    { actorUserId: input.actorUserId, notify: "after" },
  );
  await prisma.bidFollowUpAction.update({ where: { bidInvitationId_slotKey: { bidInvitationId: input.bidId, slotKey: input.slotKey } }, data: { status: "RAISED", taskId: task.id } });
  await prisma.bidInvitation.update({ where: { id: input.bidId }, data: { nextActionAt: input.dueAt, nextActionLabel: input.title } });
  return true;
}

/** The GC won the job while our scope is still undecided: an urgent call the next business morning. */
export async function onPrimeAwarded(bidId: string, actorUserId: string) {
  const b = await prisma.bidInvitation.findUnique({ where: { id: bidId }, select: { number: true, projectName: true, organization: { select: { name: true } }, bidProject: { select: { timeZone: true } } } });
  if (!b) return;
  const holidays = await loadHolidays();
  const today = todayKey();
  const day = addWorkingDays(today, 1, holidays);
  await raiseActionTask({
    bidId,
    slotKey: `prime_awarded:${today}`,
    kind: "URGENT_CALL",
    reason: "prime_awarded",
    dueAt: atLocalTime(day, 9, 0, b.bidProject?.timeZone),
    title: `Call ${b.organization.name}: they won ${b.projectName} — is our scope decided?`,
    description: `${b.organization.name} was awarded the prime contract on ${b.projectName} (${b.number}). Our subcontract is still pending: call the GC's estimator or buying PM, ask where our scope stands, and log the call with the next step.`,
    priority: "URGENT",
    actorUserId,
    planInputs: { rule: "prime_awarded", on: today },
  });
}
