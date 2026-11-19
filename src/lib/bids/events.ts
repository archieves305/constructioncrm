import { prisma } from "@/lib/db/prisma";
import { createTask } from "@/lib/tasks/create";
import { addWorkingDays } from "@/lib/time/working-days";
import { atLocalTime, todayKey } from "@/lib/time/zone";
import { loadHolidays } from "./holidays";
import { absoluteUrl } from "@/lib/notifications/links";
import { APP_TIME_ZONE } from "@/lib/time/zone";
import { INTRO_CALL_SLOT, dueLabel, introCallPlan, type IntroCallContact } from "./intro-call";

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
export async function raiseActionTask(input: { bidId: string; slotKey: string; kind: "CALL" | "REVIEW" | "URGENT_CALL"; reason: string; dueAt: Date; title: string; description: string; priority: "MEDIUM" | "HIGH" | "URGENT"; actorUserId: string | null; planInputs?: Record<string, unknown>; assigneeUserId?: string | null }): Promise<boolean> {
  const bid = await prisma.bidInvitation.findUnique({ where: { id: input.bidId }, select: { leadId: true, organizationId: true } });
  if (!bid) return false;
  try {
    await prisma.bidFollowUpAction.create({ data: { bidInvitationId: input.bidId, slotKey: input.slotKey, kind: input.kind, reason: input.reason, dueAt: input.dueAt, status: "PLANNED", planInputs: (input.planInputs ?? {}) as object } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
  const owner = input.assigneeUserId || (await opportunityOwnerId(input.bidId, input.actorUserId ?? ""));
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

export type IntroCallResult = { raised: boolean; assigneeName: string | null; dueLabel: string | null };

const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

/**
 * A bid went out to a GC for the first time: the bid's PM (else its owner)
 * calls the GC's estimator the next business morning — an introduction when
 * KNU has never bid to that GC, a "the bid is in" call when it has. Once per
 * GC per bid (slot `intro_call`); a revision raises nothing.
 */
export async function onBidSubmitted(bidId: string, submissionId: string, actorUserId: string): Promise<IntroCallResult> {
  const none: IntroCallResult = { raised: false, assigneeName: null, dueLabel: null };
  const b = await prisma.bidInvitation.findUnique({
    where: { id: bidId },
    select: {
      id: true, number: true, projectName: true, organizationId: true,
      organization: { select: { name: true } },
      pmUser: { select: { id: true, firstName: true, lastName: true, isActive: true } },
      contact: { select: { firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true, isActive: true } },
      bidProject: { select: { name: true, timeZone: true } },
      scopes: { select: { scope: { select: { label: true, sortOrder: true } } } },
      lead: { select: { services: { select: { serviceCategory: { select: { name: true } } } } } },
    },
  });
  const s = await prisma.bidSubmission.findUnique({ where: { id: submissionId }, select: { submittedAt: true, amount: true, recipients: { select: { contact: { select: { firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true } } } } } });
  if (!b || !s) return none;

  // Known GC: a submission on another of their bids, or a bid they awarded us.
  const earlier = await prisma.bidInvitation.count({ where: { organizationId: b.organizationId, id: { not: b.id }, OR: [{ submissions: { some: {} } }, { outcome: "AWARDED" }] } });

  let contacts: IntroCallContact[] = s.recipients.flatMap((r) => (r.contact ? [{ ...r.contact, name: fullName(r.contact) }] : []));
  if (!contacts.length && b.contact?.isActive) contacts = [{ ...b.contact, name: fullName(b.contact) }];
  if (!contacts.length) {
    const primary = await prisma.contact.findFirst({ where: { organizationId: b.organizationId, isActive: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { firstName: true, lastName: true, title: true, phone: true, mobile: true, email: true } });
    if (primary) contacts = [{ ...primary, name: fullName(primary) }];
  }

  const scopes = b.scopes.length
    ? [...b.scopes].sort((x, y) => x.scope.sortOrder - y.scope.sortOrder).map((x) => x.scope.label)
    : b.lead.services.map((x) => x.serviceCategory.name);
  const tz = b.bidProject?.timeZone ?? APP_TIME_ZONE;
  const plan = introCallPlan({
    submittedAt: s.submittedAt, now: new Date(), holidays: await loadHolidays(), tz,
    isFirstWithGc: earlier === 0, gc: b.organization.name, project: b.bidProject?.name ?? b.projectName, bidNumber: b.number,
    scopes, amount: Number(s.amount), contacts, accountUrl: absoluteUrl(`/partners/${b.organizationId}`),
  });
  if (!plan) return none;

  const pm = b.pmUser?.isActive ? b.pmUser : null;
  const assigneeId = pm?.id ?? (await opportunityOwnerId(bidId, actorUserId));
  const raised = await raiseActionTask({
    bidId, slotKey: INTRO_CALL_SLOT, kind: "CALL", reason: "intro_call", dueAt: plan.dueAt,
    title: plan.title, description: plan.description, priority: "HIGH", actorUserId, assigneeUserId: assigneeId,
    planInputs: { rule: "intro_call", firstWithGc: earlier === 0, submissionId, dueDay: plan.dueDay, assignedTo: pm ? "pm" : "owner" },
  });
  if (!raised) return none;
  const who = pm ?? (await prisma.user.findUnique({ where: { id: assigneeId }, select: { firstName: true, lastName: true } }));
  return { raised: true, assigneeName: who ? fullName(who) : null, dueLabel: dueLabel(plan.dueAt, tz) };
}
