import { jobHasActiveWorkflow } from "@/lib/workflows/duplicates";
import { settleJobGates } from "@/lib/workflows/gates";
import { prisma } from "@/lib/db/prisma";
import { createTask } from "@/lib/tasks/create";
import { formatAddressLine } from "@/lib/labels/address";
import { onInvoiceTransition } from "@/lib/tasks/auto-tasks";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { getEmailBrand } from "@/lib/email/brand";
import { reportDelivery } from "@/lib/email/delivery-report";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { renderReviewRequestEmail } from "@/lib/reviews/email";
import { env } from "@/lib/env";
import { logOutboundCommunication } from "@/lib/communications/log";
import { recomputeJobBalance } from "@/lib/services/job-pricing";
import { syncInvoiceStatus } from "@/lib/services/invoices";
import { applyEstimateToNewJob, autoWonEstimateFor, loadEstimatePricing } from "@/lib/estimates/job-from-estimate-load";
import type { EstimateRef } from "@/lib/estimates/job-from-estimate";
import { jobKindOf, NEXT_ACTION, stageFitsKind, type JobKind } from "@/lib/jobs/stage-kinds";

let jobCounter: number | null = null;

export async function nextJobNumber(): Promise<string> {
  if (jobCounter === null) {
    const last = await prisma.job.findFirst({ orderBy: { createdAt: "desc" }, select: { jobNumber: true } });
    jobCounter = last ? parseInt(last.jobNumber.replace("JOB-", ""), 10) : 0;
  }
  jobCounter++;
  return `JOB-${String(jobCounter).padStart(5, "0")}`;
}

/**
 * How the job is set up at Won. A homeowner job keeps the residential
 * defaults (50% deposit, lump sum). A GC bid package (lead kind GC_BID) is a
 * subcontract: progress billing, 10% retainage, no deposit and no deposit
 * task — the award path passes these, and the kind picks them when nothing
 * is passed.
 */
export type CreateJobOptions = {
  billingMethod?: "LUMP_SUM" | "PROGRESS";
  retainagePercent?: number;
  /** Absolute amount; defaults to 50% of the contract for a customer job, 0 for a bid package. */
  depositRequired?: number;
  skipDepositTask?: boolean;
  title?: string;
  contractAmount?: number;
  /**
   * The estimate the job's price and cost come from. Undefined: the one
   * estimate marked Accepted, if exactly one is (a Won with no dialog);
   * null: none — the price typed on the lead, as before.
   */
  fromEstimate?: EstimateRef | null;
  /** Cost to freeze as the baseline, ahead of the estimate's own (an awarded bid's submission snapshot). */
  estimatedCost?: number;
  /**
   * A PlanHub award event (src/lib/bids/award.ts). One job per award, so a
   * GC awarding two scopes separately gives the lead two jobs; a retry with
   * the same award returns the job it already made.
   */
  bidAwardId?: string;
};

export async function createJobFromLead(leadId: string, userId: string, opts: CreateJobOptions = {}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      services: { include: { serviceCategory: true } },
      currentStage: true,
    },
  });
  if (!lead) throw new Error("Lead not found");
  const gcBid = lead.kind === "GC_BID";

  // A job already made for this award (or, without one, for this lead) is returned, never doubled.
  const existing = await prisma.job.findFirst({ where: opts.bidAwardId ? { sourceBidAwardId: opts.bidAwardId } : { leadId } });
  if (existing) return existing;

  const wonStage = await prisma.jobStage.findFirst({ where: { name: "Won" } });
  if (!wonStage) throw new Error("Job stage 'Won' not configured");

  const depositNeededStage = await prisma.jobStage.findFirst({ where: { name: "Deposit Needed" } });

  const serviceType = lead.services.map((s) => s.serviceCategory.name).join(", ") || "General";
  // The price and cost from the estimate, when there is one (audit roadmap Stage B).
  const source = opts.fromEstimate === undefined ? await autoWonEstimateFor(leadId) : opts.fromEstimate;
  const priced = source ? await loadEstimatePricing(leadId, source) : null;
  if (source && !priced) throw new Error("That estimate is not on this lead");
  const contractAmount = opts.contractAmount ?? priced?.pricing.price ?? Number(lead.estimatedJobValue || 0);
  const depositRequired = opts.depositRequired ?? (gcBid ? 0 : Number(contractAmount) * 0.5); // Default 50% deposit on a customer job
  const billingMethod = opts.billingMethod ?? (gcBid ? "PROGRESS" : "LUMP_SUM");
  const retainagePercent = opts.retainagePercent ?? (gcBid ? 10 : 0);
  const skipDepositTask = opts.skipDepositTask ?? gcBid;

  const job = await prisma.job.create({
    data: {
      leadId,
      jobNumber: await nextJobNumber(),
      title: opts.title ?? `${serviceType} — ${formatAddressLine(lead) || lead.fullName}`,
      serviceType,
      contractAmount,
      depositRequired,
      balanceDue: contractAmount,
      billingMethod,
      retainagePercent,
      salesRepId: lead.assignedUserId,
      currentStageId: depositRequired > 0 ? depositNeededStage?.id || wonStage.id : wonStage.id,
      nextAction: depositRequired > 0 ? "Collect deposit" : gcBid ? "Return the signed subcontract" : null,
      // A cost the caller froze earlier (a bid submission's snapshot) wins over the estimate's cost today.
      estimatedCostSnapshot: opts.estimatedCost ?? priced?.pricing.cost ?? null,
      sourceEstimateId: source?.kind === "GENERIC" ? source.id : null,
      sourceRoofEstimateId: source?.kind === "ROOF" ? source.id : null,
      sourceBidAwardId: opts.bidAwardId ?? null,
      financingRequired: lead.financingNeeded,
      financingStatus: lead.financingNeeded ? "PENDING_APPLICATION" : "NOT_NEEDED",
    },
    include: { currentStage: true },
  });

  if (source && priced) await applyEstimateToNewJob(job.id, source, priced.pricing, priced.status, userId);

  // Create stage history
  await prisma.jobStageHistory.create({
    data: {
      jobId: job.id,
      toStageId: job.currentStageId,
      changedByUserId: userId,
    },
  });

  // The job starts with its workflow: Core plus the trades the lead's
  // services point at. Its "Verify deposit received" step replaces the
  // stand-alone deposit task, which is only raised when no workflow could be applied.
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: { select: { name: true } } } });
  const { autoApplyWorkflowForNewJob } = await import("@/lib/workflows/auto-apply");
  const applied = actor
    ? await autoApplyWorkflowForNewJob({
        jobId: job.id,
        serviceNames: lead.services.map((s) => s.serviceCategory.name),
        salesRepId: lead.assignedUserId,
        actor: { id: actor.id, role: actor.role.name },
      })
    : null;

  // Create deposit task
  if (!applied && !skipDepositTask && depositRequired > 0) await createTask(
    {
      jobId: job.id,
      leadId,
      title: `Collect deposit — ${formatAddressLine(lead) || job.jobNumber}`,
      description: `Deposit required: $${depositRequired.toLocaleString()}`,
      assignedUserId: lead.assignedUserId,
      createdByUserId: userId,
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      priority: "HIGH",
      source: "job_deposit",
    },
    { actorUserId: userId },
  );

  // Activity log on lead
  await prisma.activityLog.create({
    data: {
      leadId,
      activityType: "JOB_CREATED",
      title: `Job ${job.jobNumber} created`,
      description: `Contract: $${Number(contractAmount).toLocaleString()}${priced ? ` from estimate ${priced.estimateNumber} (cost $${priced.pricing.cost.toLocaleString()})` : ""} | Service: ${serviceType}${applied ? ` | Workflow applied (${["Core", ...applied.trades].join(", ")})` : ""}`,
      createdByUserId: userId,
    },
  });

  return job;
}

/** A stage that is not on the job's own list (a client stage on a flip, a sale stage on a client job). */
export class JobStageKindError extends Error {
  constructor(stageName: string, kind: JobKind) {
    super(`"${stageName}" is not a stage for ${kind === "CLIENT" ? "a client job" : kind === "FLIP" ? "a flip" : "a rental"}`);
    this.name = "JobStageKindError";
  }
}

export async function changeJobStage(jobId: string, stageId: string, userId: string, reason?: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { currentStageId: true, leadId: true, jobType: true, ownedPurpose: true },
  });
  if (!job) throw new Error("Job not found");

  const newStage = await prisma.jobStage.findUnique({ where: { id: stageId } });
  if (!newStage) throw new Error("Invalid stage");
  const kind = jobKindOf(job);
  if (!stageFitsKind(newStage, kind)) throw new JobStageKindError(newStage.name, kind);
  const nextActionMap = NEXT_ACTION;

  const [updated] = await Promise.all([
    prisma.job.update({
      where: { id: jobId },
      data: {
        currentStageId: stageId,
        nextAction: nextActionMap[newStage.name] || null,
        completionDate: newStage.isClosed ? new Date() : undefined,
      },
      include: { currentStage: true },
    }),
    prisma.jobStageHistory.create({
      data: {
        jobId,
        fromStageId: job.currentStageId,
        toStageId: stageId,
        changedByUserId: userId,
        reason,
      },
    }),
    prisma.activityLog.create({
      data: {
        leadId: job.leadId,
        activityType: "JOB_STAGE_CHANGE",
        title: `Job stage → ${newStage.name}`,
        description: reason || undefined,
        createdByUserId: userId,
      },
    }),
  ]);

  if (newStage.isClosed) {
    // Our own projects have no customer to ask for a review.
    if (kind === "CLIENT") {
      await sendReviewRequestIfNeeded(jobId, job.leadId, userId).catch((e) =>
        console.error("sendReviewRequestIfNeeded failed", e),
      );
    }
    // A corrective job for a code-violation case reached a closed stage.
    const { onJobCompleted } = await import("@/lib/violations/job-sync");
    await onJobCompleted(jobId, userId, "stage");
  }

  await spawnTasksFromTemplates(jobId, stageId, userId).catch((e) =>
    console.error("spawnTasksFromTemplates failed", e),
  );

  return updated;
}

async function spawnTasksFromTemplates(
  jobId: string,
  stageId: string,
  userId: string,
): Promise<void> {
  // A template marked "the workflow has this step" is not raised a second
  // time on a job that has a workflow.
  const hasWorkflow = await jobHasActiveWorkflow(jobId);
  const templates = await prisma.jobTaskTemplate.findMany({
    where: { stageId, isActive: true, ...(hasWorkflow ? { skipWhenWorkflow: false } : {}) },
  });
  if (templates.length === 0) return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { leadId: true, salesRepId: true, projectManagerId: true },
  });
  if (!job) return;

  const now = Date.now();
  // One batch per stage change, so the digest says "4 tasks created for
  // Production" instead of four lines.
  const notifyBatch = { key: `stage:${jobId}:${stageId}:${now}`, size: templates.length };
  for (const t of templates) {
    const assignee =
      t.defaultAssignedUserId || job.projectManagerId || job.salesRepId || null;
    const dueAt =
      t.relativeDueInDays != null
        ? new Date(now + t.relativeDueInDays * 86400000)
        : null;

    // Stage templates can spawn several tasks at once; skip the per-task
    // lead-activity row so the feed does not fill with five near-identical
    // lines on every stage change.
    await createTask(
      {
        jobId,
        leadId: job.leadId,
        title: t.title,
        description: t.description,
        priority: t.priority,
        assignedUserId: assignee,
        createdByUserId: userId,
        dueAt,
        source: "stage_template",
      },
      { actorUserId: userId, logLeadActivity: false, notifyBatch },
    );
  }
}

export async function sendReviewRequestIfNeeded(
  jobId: string,
  leadId: string,
  userId: string,
): Promise<void> {
  const existing = await prisma.reviewRequest.findFirst({
    where: { jobId },
    select: { id: true },
  });
  if (existing) return;

  const [job, sender] = await Promise.all([
    prisma.job.findUnique({
      where: { id: jobId },
      include: { lead: { select: { kind: true, email: true, emailOptedOut: true, firstName: true, propertyAddress1: true, propertyAddress2: true, city: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    }),
  ]);
  // A GC's bid package closes with no homeowner to ask.
  if (!job || job.lead.kind !== "CUSTOMER") return;

  const request = await prisma.reviewRequest.create({
    data: {
      jobId,
      leadId,
      platform: "Google",
      status: "PENDING",
    },
  });

  if (job.lead.email && !job.lead.emailOptedOut && isEmailConfigured()) {
    try {
      const { subject, html, text } = renderReviewRequestEmail({
        brand: await getEmailBrand(),
        firstName: job.lead.firstName,
        address: formatAddressLine(job.lead) || null,
        unsubscribeUrl: buildUnsubscribeUrl(leadId),
      });
      const emailResult = await sendEmail({
        to: job.lead.email,
        subject,
        html,
        text,
        // Send replies to the rep who triggered the request, not the
        // system FROM address.
        replyTo: sender?.email ?? undefined,
      });
      await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      await prisma.activityLog.create({
        data: {
          leadId,
          activityType: "REVIEW_REQUESTED",
          title: "Review request email sent",
          createdByUserId: userId,
        },
      });
      await logOutboundCommunication({
        leadId,
        channel: "EMAIL",
        provider: "mailersend",
        from: env.EMAIL_FROM || "",
        to: job.lead.email,
        subject,
        body: text,
        externalMessageId: emailResult?.id ?? null,
        createdByUserId: userId,
      });
    } catch (err) {
      console.error("review request email failed", err);
      await reportDelivery({
        source: "job.review-request",
        attempted: 1,
        sent: 0,
        failures: [{ recipient: job.lead.email, reason: err instanceof Error ? err.message : String(err) }],
        context: { jobId },
      });
    }
  }
}

export async function recordPayment(
  jobId: string,
  data: {
    paymentType: string;
    amount: number;
    notes?: string;
    method?: string | null;
    reference?: string | null;
    invoiceId?: string | null;
  },
  userId: string
) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { leadId: true } });
  if (!job) throw new Error("Job not found");

  // Validate any applied invoice belongs to this job.
  let invoiceId: string | null = null;
  if (data.invoiceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: data.invoiceId }, select: { jobId: true } });
    if (!inv || inv.jobId !== jobId) throw new Error("Invoice does not belong to this job");
    invoiceId = data.invoiceId;
  }

  const payment = await prisma.payment.create({
    data: {
      jobId,
      paymentType: data.paymentType as "DEPOSIT" | "PROGRESS" | "FINAL" | "FINANCING_FUNDING",
      amount: data.amount,
      method: (data.method as "CHECK" | "CARD" | "ACH" | "CASH" | "FINANCING" | "WIRE" | "OTHER" | null) || null,
      reference: data.reference?.trim() || null,
      status: "RECEIVED",
      receivedDate: new Date(),
      notes: data.notes,
      invoiceId,
    },
  });

  // Single writer for the balance and the deposit figures, then invoice
  // status reconciliation.
  await recomputeJobBalance(jobId);
  if (invoiceId) {
    const transition = await syncInvoiceStatus(invoiceId);
    await onInvoiceTransition(invoiceId, transition, userId);
  }

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "PAYMENT_RECEIVED",
      title: `${data.paymentType} payment: $${data.amount.toLocaleString()}`,
      createdByUserId: userId,
    },
  });

  // The deposit or the final payment is on record: the workflow step that waits on it is done.
  await settleJobGates(jobId, userId);

  return payment;
}
