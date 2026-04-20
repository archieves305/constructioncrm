import { prisma } from "@/lib/db/prisma";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";

let jobCounter: number | null = null;

async function nextJobNumber(): Promise<string> {
  if (jobCounter === null) {
    const last = await prisma.job.findFirst({ orderBy: { createdAt: "desc" }, select: { jobNumber: true } });
    jobCounter = last ? parseInt(last.jobNumber.replace("JOB-", ""), 10) : 0;
  }
  jobCounter++;
  return `JOB-${String(jobCounter).padStart(5, "0")}`;
}

export async function createJobFromLead(leadId: string, userId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      services: { include: { serviceCategory: true } },
      currentStage: true,
    },
  });
  if (!lead) throw new Error("Lead not found");

  // Check if job already exists for this lead
  const existing = await prisma.job.findFirst({ where: { leadId } });
  if (existing) return existing;

  const wonStage = await prisma.jobStage.findFirst({ where: { name: "Won" } });
  if (!wonStage) throw new Error("Job stage 'Won' not configured");

  const depositNeededStage = await prisma.jobStage.findFirst({ where: { name: "Deposit Needed" } });

  const serviceType = lead.services.map((s) => s.serviceCategory.name).join(", ") || "General";
  const contractAmount = lead.estimatedJobValue || 0;
  const depositRequired = Number(contractAmount) * 0.5; // Default 50% deposit

  const job = await prisma.job.create({
    data: {
      leadId,
      jobNumber: await nextJobNumber(),
      title: `${serviceType} — ${lead.fullName}`,
      serviceType,
      contractAmount,
      depositRequired,
      balanceDue: contractAmount,
      salesRepId: lead.assignedUserId,
      currentStageId: depositNeededStage?.id || wonStage.id,
      nextAction: "Collect deposit",
      financingRequired: lead.financingNeeded,
      financingStatus: lead.financingNeeded ? "PENDING_APPLICATION" : "NOT_NEEDED",
    },
    include: { currentStage: true },
  });

  // Create stage history
  await prisma.jobStageHistory.create({
    data: {
      jobId: job.id,
      toStageId: job.currentStageId,
      changedByUserId: userId,
    },
  });

  // Create deposit task
  await prisma.task.create({
    data: {
      jobId: job.id,
      leadId,
      title: `Collect deposit for ${job.jobNumber}`,
      description: `Deposit required: $${depositRequired.toLocaleString()}`,
      assignedUserId: lead.assignedUserId,
      createdByUserId: userId,
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      priority: "HIGH",
    },
  });

  // Activity log on lead
  await prisma.activityLog.create({
    data: {
      leadId,
      activityType: "JOB_CREATED",
      title: `Job ${job.jobNumber} created`,
      description: `Contract: $${Number(contractAmount).toLocaleString()} | Service: ${serviceType}`,
      createdByUserId: userId,
    },
  });

  return job;
}

export async function changeJobStage(jobId: string, stageId: string, userId: string, reason?: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { currentStageId: true, leadId: true } });
  if (!job) throw new Error("Job not found");

  const newStage = await prisma.jobStage.findUnique({ where: { id: stageId } });
  if (!newStage) throw new Error("Invalid stage");

  // Determine next action based on stage
  const nextActionMap: Record<string, string> = {
    "Won": "Collect deposit",
    "Deposit Needed": "Collect deposit",
    "Financing Cleared": "Schedule measurement",
    "Measure Complete": "Finalize scope",
    "Scope Finalized": "Submit permit",
    "Permit Submitted": "Follow up on permit",
    "Permit Corrections": "Resolve permit corrections",
    "Permit Approved": "Order materials",
    "Materials Ordered": "Schedule installation",
    "Scheduled": "Confirm crew and date",
    "In Progress": "Monitor progress",
    "Punch List": "Complete punch list items",
    "Final Inspection": "Schedule inspection",
    "Final Payment Due": "Collect final payment",
    "Closed": "",
  };

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
    await sendReviewRequestIfNeeded(jobId, job.leadId, userId).catch((e) =>
      console.error("sendReviewRequestIfNeeded failed", e),
    );
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
  const templates = await prisma.jobTaskTemplate.findMany({
    where: { stageId, isActive: true },
  });
  if (templates.length === 0) return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { leadId: true, salesRepId: true, projectManagerId: true },
  });
  if (!job) return;

  const now = Date.now();
  for (const t of templates) {
    const assignee =
      t.defaultAssignedUserId || job.projectManagerId || job.salesRepId || null;
    const dueAt =
      t.relativeDueInDays != null
        ? new Date(now + t.relativeDueInDays * 86400000)
        : null;

    await prisma.task.create({
      data: {
        jobId,
        leadId: job.leadId,
        title: t.title,
        description: t.description,
        priority: t.priority,
        assignedUserId: assignee,
        createdByUserId: userId,
        dueAt,
      },
    });
  }
}

async function sendReviewRequestIfNeeded(
  jobId: string,
  leadId: string,
  userId: string,
): Promise<void> {
  const existing = await prisma.reviewRequest.findFirst({
    where: { jobId },
    select: { id: true },
  });
  if (existing) return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { lead: { select: { fullName: true, email: true, firstName: true } } },
  });
  if (!job) return;

  const request = await prisma.reviewRequest.create({
    data: {
      jobId,
      leadId,
      platform: "Google",
      status: "PENDING",
    },
  });

  if (job.lead.email && isEmailConfigured()) {
    try {
      await sendEmail({
        to: job.lead.email,
        subject: `Quick favor? Share your experience with us`,
        html: `<p>Hi ${job.lead.firstName},</p>
<p>Thanks for choosing us for your recent project (${job.jobNumber}). If you have a moment, we'd really appreciate an honest review — it helps other homeowners make informed decisions.</p>
<p>Thank you!</p>`,
        text: `Hi ${job.lead.firstName}, thanks for choosing us for ${job.jobNumber}. If you have a moment, we'd appreciate a review.`,
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
    } catch (err) {
      console.error("review request email failed", err);
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
  },
  userId: string
) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { leadId: true, balanceDue: true, depositReceived: true } });
  if (!job) throw new Error("Job not found");

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
    },
  });

  // Update job financials
  const newBalance = Number(job.balanceDue) - data.amount;
  const updateData: Record<string, unknown> = {
    balanceDue: Math.max(0, newBalance),
  };

  if (data.paymentType === "DEPOSIT") {
    updateData.depositReceived = Number(job.depositReceived) + data.amount;
    updateData.depositReceivedDate = new Date();
  }
  if (data.paymentType === "FINAL" || newBalance <= 0) {
    updateData.finalPaymentReceived = true;
    updateData.finalPaymentDate = new Date();
  }

  await prisma.job.update({ where: { id: jobId }, data: updateData });

  await prisma.activityLog.create({
    data: {
      leadId: job.leadId,
      activityType: "PAYMENT_RECEIVED",
      title: `${data.paymentType} payment: $${data.amount.toLocaleString()}`,
      createdByUserId: userId,
    },
  });

  return payment;
}
