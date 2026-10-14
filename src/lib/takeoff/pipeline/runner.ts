import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { runAnalyzeStep } from "./analyze-handlers";
import { analyzeSteps, describeAnalyzeProgress } from "./analyze-plan";
import { runIndexStep } from "./handlers";
import { describeProgress, initialIndexSteps, MAX_STEP_ATTEMPTS, rollupJob, STALE_LOCK_MS, TICK_BUDGET_MS, type StepState } from "./plan";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The tick runner. A tick claims one runnable step at a time (a row lock,
 * `SKIP LOCKED`, so two ticks never take the same step), runs it, records the
 * outcome and goes again until its time budget is spent or nothing is left.
 * Steps left RUNNING by a process that died are reclaimed after a few minutes.
 * At most two steps run at once across the whole app — each one forks a
 * worker that may hold a few hundred MB.
 */
export const MAX_CONCURRENT_STEPS = 2;

export async function createIndexJob(tx: Prisma.TransactionClient, planDocumentId: string, userId: string) {
  const steps = initialIndexSteps();
  return tx.planJob.create({
    data: {
      kind: "INDEX_DOCUMENT",
      planDocumentId,
      requestedByUserId: userId,
      totalSteps: steps.length,
      steps: { create: steps.map((s) => ({ sequence: s.sequence, stepKey: s.stepKey, dependsOn: s.dependsOn })) },
    },
    select: { id: true },
  });
}

/**
 * An analysis job on a takeoff: the specs call plus one regions call per
 * roof plan the takeoff selected. The takeoff is ANALYZING until the job
 * settles. Returns null when the takeoff has no sheet the analysis can use.
 */
export async function createAnalyzeJob(takeoffId: string, userId: string, onlySheetIds?: readonly string[]) {
  const takeoff = await prisma.takeoff.findUnique({ where: { id: takeoffId }, select: { id: true, trade: true, sheets: { select: { planSheetId: true, role: true } } } });
  if (!takeoff) return null;
  const roofPlans = takeoff.sheets.filter((s) => s.role === "roof_plan" && (!onlySheetIds || onlySheetIds.includes(s.planSheetId))).map((s) => s.planSheetId);
  const steps = analyzeSteps(roofPlans, true);
  if (!steps.length) return null;
  return prisma.$transaction(async (tx) => {
    const job = await tx.planJob.create({
      data: {
        kind: "ANALYZE_TAKEOFF",
        takeoffId,
        requestedByUserId: userId,
        totalSteps: steps.length,
        steps: { create: steps.map((s) => ({ sequence: s.sequence, stepKey: s.stepKey, dependsOn: s.dependsOn })) },
      },
      select: { id: true },
    });
    await tx.takeoff.update({ where: { id: takeoffId }, data: { status: "ANALYZING" } });
    return job;
  });
}

type Claimed = { id: string; step_key: string; attempts: number };

async function reclaimStale(jobId: string): Promise<number> {
  const r = await prisma.planJobStep.updateMany({
    where: { jobId, status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "PENDING", lockToken: null, lockedAt: null },
  });
  return r.count;
}

async function claimStep(jobId: string, token: string): Promise<Claimed | null> {
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE plan_job_steps
       SET status = 'RUNNING', locked_at = now(), lock_token = ${token}, attempts = attempts + 1,
           started_at = COALESCE(started_at, now()), error = NULL
     WHERE id = (
       SELECT s.id FROM plan_job_steps s
        WHERE s.job_id = ${jobId} AND s.status = 'PENDING'
          AND NOT EXISTS (
            SELECT 1 FROM plan_job_steps d
             WHERE d.job_id = s.job_id AND d.step_key = ANY(s.depends_on)
               AND d.status NOT IN ('DONE', 'SKIPPED'))
        ORDER BY s.sequence, s.step_key
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
     RETURNING id, step_key, attempts`;
  return rows[0] ?? null;
}

async function runningAcrossApp(): Promise<number> {
  return prisma.planJobStep.count({ where: { status: "RUNNING", lockedAt: { gte: new Date(Date.now() - STALE_LOCK_MS) } } });
}

/** Recompute the job's counters and status from its steps; mark a failed document. */
export async function rollup(jobId: string) {
  const job = await prisma.planJob.findUnique({ where: { id: jobId }, select: { id: true, status: true, planDocumentId: true, takeoffId: true, startedAt: true, steps: { select: { stepKey: true, status: true, dependsOn: true, error: true } } } });
  if (!job) return null;
  const r = rollupJob(job.steps as StepState[], job.status);
  const firstError = job.steps.find((s) => s.status === "FAILED")?.error ?? null;
  const finished = r.status === "DONE" || r.status === "FAILED" || r.status === "CANCELLED";
  await prisma.planJob.update({
    where: { id: jobId },
    data: {
      status: r.status,
      totalSteps: r.totalSteps,
      doneSteps: r.doneSteps,
      failedSteps: r.failedSteps,
      error: r.status === "FAILED" ? firstError : null,
      startedAt: job.startedAt ?? new Date(),
      finishedAt: finished ? new Date() : null,
    },
  });
  if (r.status === "FAILED" && job.planDocumentId) {
    await prisma.planDocument.update({ where: { id: job.planDocumentId }, data: { status: "FAILED", error: firstError } });
  }
  if (finished && job.takeoffId) {
    // the takeoff leaves ANALYZING when its job settles: to review when there is anything to review, else back to a draft
    const t = await prisma.takeoff.findUnique({ where: { id: job.takeoffId }, select: { status: true, _count: { select: { measurements: true } } } });
    if (t?.status === "ANALYZING") await prisma.takeoff.update({ where: { id: job.takeoffId }, data: { status: r.status === "DONE" || t._count.measurements > 0 ? "IN_REVIEW" : "DRAFT" } });
  }
  return r;
}

export type TickResult = { ran: number; status: string; busy: boolean; progress: string };

/**
 * Run steps of one job until the budget is spent. Called by the browser while
 * someone watches and by the cron sweeper for jobs nobody is watching.
 */
export async function tick(jobId: string, budgetMs = TICK_BUDGET_MS): Promise<TickResult> {
  const started = Date.now();
  const token = randomBytes(8).toString("hex");
  let ran = 0;
  await reclaimStale(jobId);
  const job = await prisma.planJob.findUnique({ where: { id: jobId }, select: { id: true, status: true, kind: true, planDocumentId: true, takeoffId: true, requestedByUserId: true } });
  if (!job) throw new Error("job not found");
  if (job.status === "CANCELLED" || job.status === "DONE") return finish(jobId, ran, false);

  while (Date.now() - started < budgetMs) {
    if ((await runningAcrossApp()) >= MAX_CONCURRENT_STEPS) return finish(jobId, ran, ran === 0);
    const claimed = await claimStep(jobId, token);
    if (!claimed) break;
    if (job.status === "PENDING") await prisma.planJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });
    try {
      const result = await runStep(job, jobId, claimed.step_key);
      await prisma.planJobStep.update({ where: { id: claimed.id }, data: { status: "DONE", result, finishedAt: new Date(), lockToken: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = claimed.attempts >= MAX_STEP_ATTEMPTS;
      logger.warn("takeoff step failed", { jobId, stepKey: claimed.step_key, attempts: claimed.attempts, giveUp, message });
      await prisma.planJobStep.update({ where: { id: claimed.id }, data: { status: giveUp ? "FAILED" : "PENDING", error: message.slice(0, 500), lockToken: null, lockedAt: null, finishedAt: giveUp ? new Date() : null } });
      if (!giveUp) break; // let the next tick retry; do not spin on the same failure
    }
    ran++;
  }
  return finish(jobId, ran, false);
}

type TickJob = { kind: "INDEX_DOCUMENT" | "ANALYZE_TAKEOFF"; planDocumentId: string | null; takeoffId: string | null; requestedByUserId: string };

function runStep(job: TickJob, jobId: string, stepKey: string): Promise<Prisma.InputJsonValue> {
  if (job.kind === "INDEX_DOCUMENT" && job.planDocumentId) return runIndexStep({ jobId, planDocumentId: job.planDocumentId, stepKey });
  if (job.kind === "ANALYZE_TAKEOFF" && job.takeoffId) return runAnalyzeStep({ jobId, takeoffId: job.takeoffId, stepKey, userId: job.requestedByUserId });
  throw new Error(`no handler for ${job.kind}`);
}

async function finish(jobId: string, ran: number, busy: boolean): Promise<TickResult> {
  const r = await rollup(jobId);
  const job = await prisma.planJob.findUnique({ where: { id: jobId }, select: { kind: true } });
  const steps = await prisma.planJobStep.findMany({ where: { jobId }, select: { stepKey: true, status: true, dependsOn: true } });
  const progress = job?.kind === "ANALYZE_TAKEOFF" ? describeAnalyzeProgress(steps as StepState[]) : describeProgress(steps as StepState[]);
  return { ran, status: r?.status ?? "UNKNOWN", busy, progress };
}

/** Reset every failed step so the next tick tries again. */
export async function retryJob(jobId: string) {
  await prisma.planJobStep.updateMany({ where: { jobId, status: "FAILED" }, data: { status: "PENDING", attempts: 0, error: null, lockToken: null, lockedAt: null, finishedAt: null } });
  await prisma.planJob.update({ where: { id: jobId }, data: { status: "PENDING", error: null, finishedAt: null } });
  const job = await prisma.planJob.findUnique({ where: { id: jobId }, select: { planDocumentId: true, takeoffId: true } });
  if (job?.planDocumentId) await prisma.planDocument.update({ where: { id: job.planDocumentId }, data: { status: "INDEXING", error: null } });
  if (job?.takeoffId) await prisma.takeoff.update({ where: { id: job.takeoffId }, data: { status: "ANALYZING" } });
  return rollup(jobId);
}

export async function cancelJob(jobId: string) {
  await prisma.planJobStep.updateMany({ where: { jobId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "SKIPPED", lockToken: null, lockedAt: null } });
  await prisma.planJob.update({ where: { id: jobId }, data: { status: "CANCELLED", finishedAt: new Date() } });
  return rollup(jobId);
}

/** Jobs with work left that nobody has ticked lately: what the cron sweeper picks up. */
export async function abandonedJobIds(idleMs = 2 * 60 * 1000): Promise<string[]> {
  const rows = await prisma.planJob.findMany({
    where: { status: { in: ["PENDING", "RUNNING"] }, updatedAt: { lt: new Date(Date.now() - idleMs) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  return rows.map((r) => r.id);
}
