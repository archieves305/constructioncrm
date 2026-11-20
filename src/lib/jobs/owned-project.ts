import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { logger } from "@/lib/logger";
import { formatAddressLine } from "@/lib/labels/address";
import { nextJobNumber } from "@/lib/services/jobs";
import { updateTask } from "@/lib/tasks/update";
import { ENGINE_SKIP_PREFIX, reconcile } from "@/lib/workflows/reconcile";
import { CORE_MODULE_KEY } from "@/lib/workflows/keys";
import { jobKindOf, mapStageToKind, NEXT_ACTION, START_STAGE, type JobKind, type OwnedPurpose } from "./stage-kinds";

/**
 * Our own projects — flips and rentals (Richard, 2026-11-20).
 *
 * They are jobs of type OWNED_REHAB: cost-only, never billed. They start
 * here, not from a lead marked Won, so they never carry a deposit, a
 * contract or the customer's workflow steps. The property lives on an
 * INTERNAL lead, which every customer list, nurture, the funnel and the
 * review mail already leave out (they read `kind: "CUSTOMER"`).
 */

/** Core steps that exist only because there is a customer (Core generation 2 and 3). */
export const CUSTOMER_STEP_KEYS = ["review_contract", "verify_deposit", "submit_final_invoice", "confirm_final_payment"] as const;
const OWNED_SKIP_REASON = `${ENGINE_SKIP_PREFIX}one of our own projects — no customer`;

export type OwnedProjectInput = {
  purpose: OwnedPurpose;
  propertyAddress1: string;
  propertyAddress2?: string | null;
  city: string;
  state?: string;
  zipCode: string;
  /** Shown as the job's title; defaults to "Flip — <address>". */
  title?: string | null;
  projectManagerId?: string | null;
  purchasePrice?: number | null;
  afterRepairValue?: number | null;
  monthlyRent?: number | null;
  targetStartDate?: Date | null;
  /** The rehab budget: lines by category, or one total. */
  budgetLines?: { name: string; category?: string | null; amount: number }[];
  budgetTotal?: number | null;
};

export type Actor = { id: string; role: RoleName };

/** The budget lines a new project starts with. Pure. */
export function planBudgetLines(input: Pick<OwnedProjectInput, "budgetLines" | "budgetTotal">): { name: string; category: string | null; amount: number; sortOrder: number }[] {
  const lines = (input.budgetLines ?? []).filter((l) => l.name.trim() && Number.isFinite(l.amount) && l.amount > 0);
  if (lines.length > 0) {
    return lines.map((l, i) => ({ name: l.name.trim(), category: l.category?.trim() || null, amount: Math.round(l.amount * 100) / 100, sortOrder: i }));
  }
  const total = input.budgetTotal ?? 0;
  return total > 0 ? [{ name: "Rehab budget", category: null, amount: Math.round(total * 100) / 100, sortOrder: 0 }] : [];
}

export async function createOwnedProject(input: OwnedProjectInput, actor: Actor) {
  const [leadStage, jobStage] = await Promise.all([
    // The property record is never a sale in progress: it sits in the Won lead stage, off every open-lead count.
    prisma.leadStage.findFirst({ where: { isWon: true }, orderBy: { stageOrder: "asc" }, select: { id: true } }),
    prisma.jobStage.findFirst({ where: { name: START_STAGE[input.purpose] }, select: { id: true, name: true } }),
  ]);
  if (!leadStage) throw new Error("No Won lead stage is configured");
  if (!jobStage) throw new Error(`Job stage "${START_STAGE[input.purpose]}" is not configured — the owned-projects migration has not run`);

  const label = input.purpose === "FLIP" ? "Flip" : "Rental";
  const address = formatAddressLine({ propertyAddress1: input.propertyAddress1, propertyAddress2: input.propertyAddress2 ?? null, city: input.city });
  const budget = planBudgetLines(input);
  // Somebody runs it: whoever starts the project, unless they name someone else.
  const projectManagerId = input.projectManagerId ?? actor.id;

  const job = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        kind: "INTERNAL",
        firstName: "KNU",
        lastName: label,
        fullName: `Our ${label.toLowerCase()}`,
        companyName: "KNU Construction",
        primaryPhone: "",
        propertyAddress1: input.propertyAddress1.trim(),
        propertyAddress2: input.propertyAddress2?.trim() || null,
        city: input.city.trim(),
        state: input.state?.trim() || "FL",
        zipCode: input.zipCode.trim(),
        currentStageId: leadStage.id,
        assignedUserId: projectManagerId,
        createdByUserId: actor.id,
        emailOptedOut: true,
      },
    });
    const job = await tx.job.create({
      data: {
        leadId: lead.id,
        jobNumber: await nextJobNumber(),
        title: input.title?.trim() || `${label} — ${address || input.propertyAddress1.trim()}`,
        serviceType: label,
        jobType: "OWNED_REHAB",
        ownedPurpose: input.purpose,
        contractAmount: 0,
        depositRequired: 0,
        balanceDue: 0,
        marginValue: 0,
        purchasePrice: input.purchasePrice ?? null,
        afterRepairValue: input.purpose === "FLIP" ? (input.afterRepairValue ?? null) : null,
        monthlyRent: input.purpose === "RENTAL" ? (input.monthlyRent ?? null) : null,
        targetStartDate: input.targetStartDate ?? null,
        projectManagerId,
        currentStageId: jobStage.id,
        nextAction: NEXT_ACTION[jobStage.name] || null,
      },
    });
    if (budget.length > 0) await tx.budgetLine.createMany({ data: budget.map((b) => ({ ...b, jobId: job.id })) });
    await tx.jobStageHistory.create({ data: { jobId: job.id, toStageId: jobStage.id, changedByUserId: actor.id } });
    await tx.activityLog.create({
      data: {
        leadId: lead.id,
        activityType: "JOB_CREATED",
        title: `Job ${job.jobNumber} created`,
        description: `Our own ${label.toLowerCase()}${budget.length ? ` · budget $${budget.reduce((s, b) => s + b.amount, 0).toLocaleString()}` : ""}`,
        createdByUserId: actor.id,
      },
    });
    return job;
  });

  // Core only, with its "Client job" toggle off (the engine forces it from the job type).
  const { autoApplyWorkflowForNewJob } = await import("@/lib/workflows/auto-apply");
  const applied = await autoApplyWorkflowForNewJob({ jobId: job.id, serviceNames: [], salesRepId: null, actor });

  await recordAudit({
    actorUserId: actor.id,
    entityType: "Job",
    entityId: job.id,
    action: "owned_project_create",
    after: { purpose: input.purpose, budget: budget.reduce((s, b) => s + b.amount, 0), purchasePrice: input.purchasePrice ?? null, workflow: Boolean(applied) },
  });
  return job;
}

/**
 * Plan of a change of kind (client ↔ flip ↔ rental). Pure: what the job's
 * fields become and which stage it moves to.
 */
export function planKindChange<S extends { id: string; name: string; stageOrder: number; kinds: readonly string[] }>(input: {
  stages: readonly S[];
  current: { name: string; stageOrder: number };
  to: JobKind;
}): { stage: S | null; data: { jobType?: "OWNED_REHAB"; ownedPurpose: OwnedPurpose | null; depositRequired?: number } } {
  const stage = mapStageToKind(input.stages, input.current, input.to);
  if (input.to === "CLIENT") return { stage, data: { ownedPurpose: null } };
  return { stage, data: { jobType: "OWNED_REHAB", ownedPurpose: input.to, depositRequired: 0 } };
}

/**
 * Move a job to another kind. To an owned kind: jobType OWNED_REHAB, the
 * purpose, no deposit, the matching stage, and the customer's workflow steps
 * stood down. Back to a client job: the caller has already set the client
 * jobType (FIXED_PRICE / COST_PLUS); the stage moves and the steps return.
 * Audited. Returns what changed, or null when nothing did.
 */
export async function changeJobKind(jobId: string, to: JobKind, actor: Actor, opts: { clientJobType?: "FIXED_PRICE" | "COST_PLUS" } = {}) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, leadId: true, jobType: true, ownedPurpose: true, depositRequired: true, currentStage: { select: { id: true, name: true, stageOrder: true } }, workflow: { select: { id: true, scopeToggles: true } } },
  });
  if (!job) throw new Error("Job not found");
  const from = jobKindOf(job);
  if (from === to) return null;

  const stages = await prisma.jobStage.findMany({ select: { id: true, name: true, stageOrder: true, kinds: true } });
  const plan = planKindChange({ stages, current: job.currentStage, to });
  const data = to === "CLIENT" ? { ...plan.data, jobType: opts.clientJobType ?? "FIXED_PRICE" } : plan.data;

  await prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: {
        ...data,
        ...(plan.stage && plan.stage.id !== job.currentStage.id ? { currentStageId: plan.stage.id, nextAction: NEXT_ACTION[plan.stage.name] || null } : {}),
      },
    });
    if (plan.stage && plan.stage.id !== job.currentStage.id) {
      await tx.jobStageHistory.create({ data: { jobId, fromStageId: job.currentStage.id, toStageId: plan.stage.id, changedByUserId: actor.id, reason: `Now ${to === "CLIENT" ? "a client job" : to === "FLIP" ? "a flip" : "a rental"}` } });
    }
  });

  // The customer's steps follow the kind. Core generation 3 does it through
  // its toggle (reconcile forces it from the job type); a job still on
  // generation 2 has no toggle, so its open customer steps are stood down by hand.
  if (job.workflow) {
    try {
      await reconcile(job.workflow.id, { kind: "scope", scopeToggles: (job.workflow.scopeToggles ?? {}) as Record<string, Record<string, boolean>> }, actor);
    } catch (err) {
      logger.warn("owned-project: workflow reconcile on kind change refused", { jobId, err: err instanceof Error ? err.message : String(err) });
    }
    if (to !== "CLIENT") await skipCustomerSteps(job.workflow.id, actor);
  }

  await recordAudit({
    actorUserId: actor.id,
    entityType: "Job",
    entityId: jobId,
    action: "job_kind_change",
    before: { kind: from, jobType: job.jobType, ownedPurpose: job.ownedPurpose, depositRequired: Number(job.depositRequired), stage: job.currentStage.name },
    after: { kind: to, ...data, stage: plan.stage?.name ?? job.currentStage.name },
  });
  return { from, to, stage: plan.stage?.name ?? job.currentStage.name };
}

/** Stand down the open customer steps on an owned job's workflow. Returns how many. */
export async function skipCustomerSteps(instanceId: string, actor: Actor): Promise<number> {
  const open = await prisma.task.findMany({
    where: {
      workflowInstanceId: instanceId,
      workflowTaskKey: { in: CUSTOMER_STEP_KEYS.map((k) => `${CORE_MODULE_KEY}:${k}`) },
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: { id: true },
  });
  for (const t of open) {
    await updateTask({ id: t.id, input: { status: "CANCELLED", skipReason: OWNED_SKIP_REASON }, actorUserId: actor.id, actorRole: actor.role, notify: "none", internal: { bypassGate: true } });
  }
  return open.length;
}
