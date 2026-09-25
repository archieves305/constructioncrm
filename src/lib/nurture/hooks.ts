// Live hooks from the write paths that change a lead's cadence. Every one is
// best-effort (logged, never thrown) and a no-op when the lead has no
// nurture state — enrolment is the cron's job. The cron also reconciles, so
// a missed hook costs a day, not correctness.

import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { closeAutoTask, sourceKeyFor } from "@/lib/tasks/auto-tasks";
import { cadenceOf, loadNurtureSettings } from "./settings";
import { initialState, schedule, stateAfterReanchor, type PlannableState } from "./plan";

type StageLike = { id: string; name: string; isClosed: boolean; isWon: boolean; isLost: boolean };

const STATE_SELECT = {
  id: true,
  leadId: true,
  status: true,
  anchorAt: true,
  followUpStep: true,
  nurtureBaseAt: true,
  nurtureSlot: true,
  nextFollowUpAt: true,
  nextNurtureAt: true,
  lastAutoEmailAt: true,
  lastPersonalTouchAt: true,
  repPromptedAt: true,
  stepsExhaustedNotifiedAt: true,
  nurtureExhaustedAt: true,
  pausedByUserId: true,
  pausedReason: true,
  enrolledAt: true,
} as const;

async function closePrompt(leadId: string, because: string) {
  await closeAutoTask(sourceKeyFor({ kind: "nurture.personal-touch", leadId }), { actorUserId: null, outcome: "CANCELLED", because });
}

async function stop(leadId: string, reason: string, because: string) {
  await prisma.leadNurtureState.updateMany({ where: { leadId, status: { not: "STOPPED" } }, data: { status: "STOPPED", stoppedReason: reason, nextFollowUpAt: null, nextNurtureAt: null } });
  await closePrompt(leadId, because);
}

/** Won / Lost / closed → stop; an open stage → re-anchor with the step reset (and re-enrol a re-opened lead). */
export async function onLeadStageChanged(leadId: string, stage: StageLike, at: Date = new Date()): Promise<void> {
  try {
    if (stage.isClosed) {
      await stop(leadId, stage.isWon ? "won" : stage.isLost ? "lost" : "closed", `lead ${stage.isWon ? "won" : stage.isLost ? "lost" : "closed"}`);
      return;
    }
    const state = await prisma.leadNurtureState.findUnique({ where: { leadId }, select: STATE_SELECT });
    const settings = cadenceOf(await loadNurtureSettings());
    const excluded = settings.excludedStageIds.includes(stage.id);
    if (!state) return; // the cron enrols
    if (state.status === "STOPPED") {
      // Re-opened from Lost (or similar): fresh anchor, keep what was already sent.
      const init = initialState([{ kind: "stage_change", at, detail: stage.name }], at, settings, { excludedStage: excluded });
      await prisma.leadNurtureState.update({
        where: { id: state.id },
        data: { ...init, nurtureBaseAt: state.nurtureBaseAt, nurtureSlot: state.nurtureSlot, stoppedReason: null, pausedByUserId: null, repPromptedAt: null, stepsExhaustedNotifiedAt: null },
      });
      return;
    }
    const patch = stateAfterReanchor(state as PlannableState, at, `stage_change:${stage.name}`, { resetStep: true, nurtureExhausted: Boolean(state.nurtureExhaustedAt) }, settings);
    const statusPatch = state.pausedByUserId
      ? {}
      : excluded
        ? { status: "PAUSED" as const, pausedReason: "stage_excluded" }
        : { status: "ACTIVE" as const, pausedReason: null };
    await prisma.leadNurtureState.update({ where: { id: state.id }, data: { ...patch, ...statusPatch } });
  } catch (err) {
    logger.exception(err, { where: "nurture.onLeadStageChanged", leadId });
  }
}

/** A rep called, texted, emailed or logged a note; or the customer replied. Re-anchors (step kept) and clears the prompt. */
export async function onPersonalTouch(leadId: string, at: Date = new Date(), source: string = "communication"): Promise<void> {
  try {
    const state = await prisma.leadNurtureState.findUnique({ where: { leadId }, select: STATE_SELECT });
    if (!state || state.status === "STOPPED") return;
    const settings = cadenceOf(await loadNurtureSettings());
    const patch = stateAfterReanchor(state as PlannableState, at, `personal_touch:${source}`, { resetStep: false, nurtureExhausted: Boolean(state.nurtureExhaustedAt) }, settings);
    await prisma.leadNurtureState.update({ where: { id: state.id }, data: { ...patch, lastPersonalTouchAt: at, repPromptedAt: null } });
    await closePrompt(leadId, `personal touch logged (${source})`);
  } catch (err) {
    logger.exception(err, { where: "nurture.onPersonalTouch", leadId });
  }
}

async function reanchorReset(leadId: string, at: Date, reason: string, where: string) {
  try {
    const state = await prisma.leadNurtureState.findUnique({ where: { leadId }, select: STATE_SELECT });
    if (!state || state.status === "STOPPED") return;
    const settings = cadenceOf(await loadNurtureSettings());
    const patch = stateAfterReanchor(state as PlannableState, at, reason, { resetStep: true, nurtureExhausted: Boolean(state.nurtureExhaustedAt) }, settings);
    await prisma.leadNurtureState.update({ where: { id: state.id }, data: patch });
  } catch (err) {
    logger.exception(err, { where, leadId });
  }
}

export function onEstimateSent(leadId: string, at: Date = new Date()): Promise<void> {
  return reanchorReset(leadId, at, "estimate_sent", "nurture.onEstimateSent");
}

export function onContractSent(leadId: string, at: Date = new Date()): Promise<void> {
  return reanchorReset(leadId, at, "contract_sent", "nurture.onContractSent");
}

export async function onLeadOptedOut(leadId: string): Promise<void> {
  try {
    await stop(leadId, "opted_out", "customer unsubscribed");
  } catch (err) {
    logger.exception(err, { where: "nurture.onLeadOptedOut", leadId });
  }
}

/** Manual controls from the lead card and the admin queue. Returns the state, or null when the lead cannot be enrolled. */
export async function setNurtureStatus(leadId: string, action: "pause" | "resume" | "stop" | "enrol", actorUserId: string, now: Date = new Date()) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, email: true, emailOptedOut: true, createdAt: true, currentStage: { select: { id: true, name: true, isClosed: true } } } });
  if (!lead) return null;
  const settings = cadenceOf(await loadNurtureSettings());
  const existing = await prisma.leadNurtureState.findUnique({ where: { leadId }, select: STATE_SELECT });

  if (action === "enrol") {
    if (!lead.email || lead.emailOptedOut || lead.currentStage.isClosed) return null;
    const excluded = settings.excludedStageIds.includes(lead.currentStage.id);
    const init = initialState([{ kind: "created", at: lead.createdAt }, { kind: "stage_change", at: now, detail: "enrolled" }], now, settings, { excludedStage: excluded });
    if (!existing) return prisma.leadNurtureState.create({ data: { leadId, ...init } });
    return prisma.leadNurtureState.update({
      where: { id: existing.id },
      data: { ...init, nurtureBaseAt: existing.nurtureBaseAt, nurtureSlot: existing.nurtureSlot, stoppedReason: null, pausedByUserId: null, repPromptedAt: null, stepsExhaustedNotifiedAt: null },
    });
  }
  if (!existing) return null;
  if (action === "pause") {
    await closePrompt(leadId, "paused by staff");
    return prisma.leadNurtureState.update({ where: { id: existing.id }, data: { status: "PAUSED", pausedReason: "manual", pausedByUserId: actorUserId } });
  }
  if (action === "stop") {
    await closePrompt(leadId, "stopped by staff");
    return prisma.leadNurtureState.update({ where: { id: existing.id }, data: { status: "STOPPED", stoppedReason: "manual", nextFollowUpAt: null, nextNurtureAt: null } });
  }
  // resume: recompute from the current anchor so nothing fires the moment it wakes up.
  const sched = schedule(existing, settings, { nurtureExhausted: Boolean(existing.nurtureExhaustedAt) });
  return prisma.leadNurtureState.update({
    where: { id: existing.id },
    data: { status: "ACTIVE", pausedReason: null, pausedByUserId: null, stoppedReason: null, nextFollowUpAt: sched.nextFollowUpAt, nextNurtureAt: sched.nextNurtureAt },
  });
}

/** After new nurture content is published: leads that ran out of pieces get a next date again. */
export async function reopenNurtureForExhausted(now: Date = new Date()): Promise<number> {
  const settings = cadenceOf(await loadNurtureSettings());
  const states = await prisma.leadNurtureState.findMany({ where: { status: "ACTIVE", nurtureExhaustedAt: { not: null } }, select: STATE_SELECT });
  for (const s of states) {
    const sched = schedule(s, settings);
    const next = sched.nextNurtureAt && sched.nextNurtureAt.getTime() < now.getTime() ? now : sched.nextNurtureAt;
    await prisma.leadNurtureState.update({ where: { id: s.id }, data: { nurtureExhaustedAt: null, nextNurtureAt: next } });
  }
  return states.length;
}

/** After the cadence settings change: every active state gets fresh next dates. */
export async function recomputeAllSchedules(): Promise<number> {
  const settings = cadenceOf(await loadNurtureSettings());
  const states = await prisma.leadNurtureState.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: STATE_SELECT });
  for (const s of states) {
    const sched = schedule(s, settings, { nurtureExhausted: Boolean(s.nurtureExhaustedAt) });
    await prisma.leadNurtureState.update({ where: { id: s.id }, data: { nextFollowUpAt: sched.nextFollowUpAt, nextNurtureAt: sched.nextNurtureAt } });
  }
  return states.length;
}
