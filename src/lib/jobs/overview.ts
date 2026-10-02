import { prisma } from "@/lib/db/prisma";
import { isPastDue } from "@/lib/calendar/status";
import { APP_TIME_ZONE, dayKey, diffDayKeys, addDayKeys, endOfDayIn } from "@/lib/time/zone";
import { ACTIVE_OPEN_WHERE } from "@/lib/workflows/state";
import { loadJobWorkflowSummaries } from "@/lib/workflows/summary";
import { deriveJobHealth, type JobHealth } from "./health";
import { mergeTimeline, money0, type JobEvent } from "./timeline";

/**
 * Everything the job's Overview tab shows, in one read.
 *
 * Nothing here is new data: it gathers what the Workflow, Tasks, Permits,
 * Money and Field tabs each hold so the state of a job can be read from one
 * screen. Health is derived (`health.ts`); the timeline is merged
 * (`timeline.ts`). Cost uses the same three streams as the Collections
 * profitability table (`services/financials.ts`) so the two always agree.
 */
const person = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}` : null);
const num = (d: unknown) => Number(d ?? 0);

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

export type OverviewTask = {
  id: string;
  title: string;
  status: string;
  dueAt: Date | null;
  allDay: boolean;
  overdue: boolean;
  assignee: string | null;
  isStep: boolean;
  blockedReason: string | null;
  failedInspection: boolean;
};

export async function loadJobOverview(jobId: string, now: Date = new Date()) {
  const tz = APP_TIME_ZONE;
  const today = dayKey(now, tz);
  const weekEnd = endOfDayIn(addDayKeys(today, 7), tz);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobType: true,
      contractAmount: true,
      balanceDue: true,
      laborCost: true,
      depositRequired: true,
      depositReceived: true,
      targetStartDate: true,
      nextAction: true,
      createdAt: true,
      currentStage: { select: { name: true, isClosed: true } },
      projectManager: PERSON,
      stageHistory: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
    },
  });
  if (!job) return null;

  const [
    summaries,
    openTasks,
    permits,
    paid,
    approvedExpenses,
    pendingExpenses,
    fieldLabor,
    changeOrders,
    logsAwaiting,
    stageRows,
    paymentRows,
    expenseRows,
    invoiceRows,
    logRows,
    taskEvents,
    contractRows,
  ] = await Promise.all([
    loadJobWorkflowSummaries([jobId], now),
    prisma.task.findMany({
      where: { jobId, ...ACTIVE_OPEN_WHERE },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, title: true, status: true, dueAt: true, allDay: true, blockedReason: true,
        inspectionResult: true, workflowTaskKey: true, assignedTo: PERSON,
      },
    }),
    prisma.jobPermit.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, permitType: true, municipality: true, permitNumber: true, status: true,
        submittedDate: true, approvedDate: true, expirationDate: true, finalPassedDate: true, createdAt: true,
        inspections: {
          orderBy: { scheduledFor: "asc" },
          select: { id: true, type: true, scheduledFor: true, completedAt: true, result: true, inspectorName: true },
        },
      },
    }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { jobId, status: "RECEIVED" } }),
    prisma.jobExpense.aggregate({ _sum: { amount: true }, where: { jobId, status: "APPROVED" } }),
    prisma.jobExpense.aggregate({ _sum: { amount: true }, _count: true, where: { jobId, status: "PENDING" } }),
    prisma.dailyLaborEntry.aggregate({ _sum: { totalCost: true }, where: { jobId, isAbsent: false, payrollPaymentId: null } }),
    prisma.changeOrder.findMany({
      where: { jobId },
      select: { id: true, number: true, title: true, customerPrice: true, status: true, sentAt: true, decidedAt: true, createdAt: true },
    }),
    prisma.dailyLog.count({ where: { jobId, status: "SUBMITTED" } }),
    prisma.jobStageHistory.findMany({
      where: { jobId }, orderBy: { changedAt: "desc" }, take: 15,
      select: { id: true, changedAt: true, toStage: { select: { name: true } }, changedBy: PERSON },
    }),
    prisma.payment.findMany({
      where: { jobId, status: "RECEIVED" }, orderBy: { receivedDate: "desc" }, take: 15,
      select: { id: true, amount: true, paymentType: true, receivedDate: true, createdAt: true },
    }),
    prisma.jobExpense.findMany({
      where: { jobId, status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 15,
      select: { id: true, amount: true, type: true, vendor: true, createdAt: true, externalId: true, createdBy: PERSON },
    }),
    prisma.invoice.findMany({
      where: { jobId, status: { not: "DRAFT" } }, orderBy: { issueDate: "desc" }, take: 15,
      select: { id: true, invoiceNumber: true, amount: true, issueDate: true, status: true, applicationNumber: true },
    }),
    prisma.dailyLog.findMany({
      where: { jobId, status: { in: ["SUBMITTED", "APPROVED"] } }, orderBy: { logDate: "desc" }, take: 15,
      select: { id: true, logDate: true, status: true, submittedAt: true, approvedAt: true, submittedBy: PERSON, approvedBy: PERSON },
    }),
    prisma.taskEvent.findMany({
      where: {
        task: { jobId },
        OR: [
          { type: "STATUS_CHANGED", toValue: "COMPLETED" },
          // Skips are left out: a re-plan or a migration skips dozens of steps
          // at once and would bury everything else.
          { type: { in: ["BLOCKED", "INSPECTION_RESULT", "EVIDENCE_ATTACHED"] } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, type: true, body: true, toValue: true, createdAt: true, actor: PERSON, task: { select: { title: true } } },
    }),
    prisma.customerContract.findMany({
      where: { jobId },
      select: { id: true, contractNumber: true, status: true, sentAt: true, signedAt: true, declinedAt: true, signerName: true },
    }),
  ]);

  // ── Tasks ────────────────────────────────────────────────────────────────
  const tasks: OverviewTask[] = openTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueAt: t.dueAt,
    allDay: t.allDay,
    overdue: isPastDue(t.dueAt, t.allDay, now, tz),
    assignee: person(t.assignedTo),
    isStep: t.workflowTaskKey !== null,
    blockedReason: t.blockedReason,
    failedInspection: t.status === "BLOCKED" && t.inspectionResult === "FAIL",
  }));
  const overdue = tasks.filter((t) => t.overdue);
  const blockers = tasks.filter((t) => t.status === "BLOCKED");
  const oldestOverdueDays = overdue.reduce((m, t) => Math.max(m, t.dueAt ? diffDayKeys(dayKey(t.dueAt, tz), today) : 0), 0);
  const toDoNow = tasks.filter((t) => t.status !== "BLOCKED").slice(0, 5);
  // What is dated this week beyond the rows "Next up" already shows.
  const shown = new Set(toDoNow.map((t) => t.id));
  const next7 = tasks.filter((t) => t.dueAt && !t.overdue && t.dueAt <= weekEnd && t.status !== "BLOCKED" && !shown.has(t.id)).slice(0, 8);

  // ── Permits and inspections ──────────────────────────────────────────────
  const inForce = permits.filter((p) => p.expirationDate && p.status !== "FINAL" && p.status !== "DENIED");
  const permitExpiresInDays = inForce.length
    ? Math.min(...inForce.map((p) => diffDayKeys(today, dayKey(p.expirationDate!, "UTC"))))
    : null;
  const upcomingInspections = permits
    .flatMap((p) => p.inspections.map((i) => ({ ...i, permitType: p.permitType, municipality: p.municipality })))
    .filter((i) => i.result === "SCHEDULED" && i.scheduledFor)
    .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime());
  const nextInspection = upcomingInspections.find((i) => dayKey(i.scheduledFor!, tz) >= today) ?? upcomingInspections[0] ?? null;

  // ── Workflow ─────────────────────────────────────────────────────────────
  const wf = summaries.get(jobId) ?? null;

  const health: JobHealth = deriveJobHealth({
    closed: job.currentStage.isClosed,
    hasWorkflow: wf !== null,
    openTasks: tasks.length,
    overdueTasks: overdue.length,
    oldestOverdueDays,
    blockedTasks: blockers.length,
    failedInspections: tasks.filter((t) => t.failedInspection).length,
    permitExpiresInDays,
  });

  // ── Money ────────────────────────────────────────────────────────────────
  const contract = num(job.contractAmount);
  const expenses = num(approvedExpenses._sum.amount);
  const contractLabor = num(job.laborCost);
  const fieldLaborCost = num(fieldLabor._sum.totalCost);
  const cost = contractLabor + fieldLaborCost + expenses;
  const billable = job.jobType !== "OWNED_REHAB";
  const sentCos = changeOrders.filter((c) => c.status === "SENT");

  // ── Timeline ─────────────────────────────────────────────────────────────
  const events: JobEvent[][] = [
    stageRows.map((r) => ({ id: `stage:${r.id}`, kind: "stage", at: r.changedAt, title: `Moved to ${r.toStage.name}`, actor: person(r.changedBy), tab: "history" })),
    paymentRows.map((p) => ({
      id: `payment:${p.id}`, kind: "payment", at: p.receivedDate ?? p.createdAt,
      title: `${p.paymentType === "DEPOSIT" ? "Deposit" : p.paymentType === "FINAL" ? "Final payment" : "Payment"} of ${money0(num(p.amount))} received`,
      tab: "money", sub: "payments",
    })),
    expenseRows.map((e) => ({
      id: `expense:${e.id}`, kind: "expense", at: e.createdAt,
      title: `${num(e.amount) < 0 ? "Credit" : "Expense"} of ${money0(Math.abs(num(e.amount)))} ${e.externalId ? "posted from the bank feed" : "added"}`,
      actor: e.externalId ? null : person(e.createdBy), tab: "money", sub: "expenses",
    })),
    invoiceRows.map((i) => ({
      id: `invoice:${i.id}`, kind: "invoice", at: i.issueDate,
      title: `${i.applicationNumber ? `Payment application #${i.applicationNumber}` : `Invoice ${i.invoiceNumber}`} issued for ${money0(num(i.amount))}`,
      tab: "money", sub: "invoices",
    })),
    changeOrders.flatMap((c) => {
      const name = `Change order #${c.number}${c.title ? ` (${c.title})` : ""}`;
      const out: JobEvent[] = [];
      if (c.sentAt) out.push({ id: `co-sent:${c.id}`, kind: "change_order", at: c.sentAt, title: `${name} sent for ${money0(num(c.customerPrice))}`, tab: "money", sub: "change-orders" });
      if (c.decidedAt && (c.status === "APPROVED" || c.status === "REJECTED")) {
        out.push({ id: `co-decided:${c.id}`, kind: "change_order", at: c.decidedAt, title: `${name} ${c.status === "APPROVED" ? "approved" : "rejected"}`, tab: "money", sub: "change-orders" });
      }
      return out;
    }),
    contractRows.flatMap((c) => {
      const out: JobEvent[] = [];
      if (c.sentAt) out.push({ id: `contract-sent:${c.id}`, kind: "contract", at: c.sentAt, title: `Contract ${c.contractNumber} sent for signature`, tab: "money", sub: "contract" });
      if (c.signedAt) out.push({ id: `contract-signed:${c.id}`, kind: "contract", at: c.signedAt, title: `Contract ${c.contractNumber} signed${c.signerName ? ` by ${c.signerName}` : ""}`, tab: "money", sub: "contract" });
      if (c.declinedAt) out.push({ id: `contract-declined:${c.id}`, kind: "contract", at: c.declinedAt, title: `Contract ${c.contractNumber} declined`, tab: "money", sub: "contract" });
      return out;
    }),
    permits.flatMap((p) => {
      const name = `${p.permitType ?? "Permit"}${p.permitNumber ? ` #${p.permitNumber}` : ""}`;
      const out: JobEvent[] = [{ id: `permit-added:${p.id}`, kind: "permit", at: p.submittedDate ?? p.createdAt, title: `${name} submitted to ${p.municipality}`, tab: "permits" }];
      if (p.approvedDate) out.push({ id: `permit-approved:${p.id}`, kind: "permit", at: p.approvedDate, title: `${name} issued`, tab: "permits" });
      if (p.finalPassedDate) out.push({ id: `permit-final:${p.id}`, kind: "permit", at: p.finalPassedDate, title: `${name} passed final`, tab: "permits" });
      for (const i of p.inspections) {
        if (i.completedAt && i.result !== "SCHEDULED") {
          out.push({ id: `inspection:${i.id}`, kind: "inspection", at: i.completedAt, title: `${humanize(i.type)} inspection: ${humanize(i.result)}`, actor: i.inspectorName, tab: "permits" });
        }
      }
      return out;
    }),
    logRows.flatMap((l) => {
      const day = l.logDate.toISOString().slice(0, 10);
      const out: JobEvent[] = [];
      if (l.submittedAt) out.push({ id: `log-submitted:${l.id}`, kind: "daily_log", at: l.submittedAt, title: `Daily log for ${day} submitted`, actor: person(l.submittedBy), tab: "field", sub: "daily-logs" });
      if (l.approvedAt) out.push({ id: `log-approved:${l.id}`, kind: "daily_log", at: l.approvedAt, title: `Daily log for ${day} approved`, actor: person(l.approvedBy), tab: "field", sub: "daily-logs" });
      return out;
    }),
    taskEvents.map((e) => {
      const t = `“${e.task.title}”`;
      const title =
        e.type === "STATUS_CHANGED" ? `Completed ${t}`
        : e.type === "BLOCKED" ? `Blocked ${t}${e.body ? `: ${e.body}` : ""}`
        : e.type === "INSPECTION_RESULT" ? `Inspection ${humanize(e.toValue ?? "")} on ${t}`
        : `Attached ${e.body ?? "a file"} to ${t}`;
      return {
        id: `task-event:${e.id}`,
        kind: e.type === "INSPECTION_RESULT" ? "inspection" : e.type === "EVIDENCE_ATTACHED" ? "file" : "task",
        at: e.createdAt, title, actor: person(e.actor), tab: "tasks",
      } satisfies JobEvent;
    }),
  ];

  return {
    health,
    stage: {
      name: job.currentStage.name,
      daysInStage: diffDayKeys(dayKey(job.stageHistory[0]?.changedAt ?? job.createdAt, tz), today),
    },
    projectManager: person(job.projectManager),
    targetStartDate: job.targetStartDate,
    nextAction: job.nextAction,
    workflow: wf
      ? {
          percentComplete: wf.percentComplete,
          currentPhase: wf.currentPhase?.name ?? null,
          done: wf.done,
          total: wf.total - wf.skipped,
          ready: wf.ready,
          unassigned: wf.unassigned,
          permitStatus: wf.permitStatus,
        }
      : null,
    tasks: {
      open: tasks.length,
      overdue: overdue.length,
      blocked: blockers.length,
      toDoNow,
      next7,
      overdueList: overdue.slice(0, 5),
      blockers,
    },
    permits: permits.map((p) => ({
      id: p.id,
      type: p.permitType,
      municipality: p.municipality,
      number: p.permitNumber,
      status: p.status,
      expirationDate: p.expirationDate,
      expiresInDays: p.expirationDate ? diffDayKeys(today, dayKey(p.expirationDate, "UTC")) : null,
    })),
    nextInspection: nextInspection
      ? { id: nextInspection.id, type: nextInspection.type, scheduledFor: nextInspection.scheduledFor, permitType: nextInspection.permitType, municipality: nextInspection.municipality, inspectorName: nextInspection.inspectorName }
      : null,
    money: {
      billable,
      contract,
      paid: num(paid._sum.amount),
      balanceDue: num(job.balanceDue),
      depositRequired: num(job.depositRequired),
      depositReceived: num(job.depositReceived),
      cost,
      costBreakdown: { contractLabor, fieldLabor: fieldLaborCost, expenses },
      // With no cost on file a "profit" is just the contract restated; say nothing instead.
      profit: billable && cost !== 0 ? contract - cost : null,
      margin: billable && cost !== 0 && contract > 0 ? (contract - cost) / contract : null,
      changeOrdersAwaiting: { count: sentCos.length, total: sentCos.reduce((s, c) => s + num(c.customerPrice), 0) },
      pendingExpenses: { count: pendingExpenses._count, total: num(pendingExpenses._sum.amount) },
    },
    field: { dailyLogsAwaitingApproval: logsAwaiting },
    timeline: mergeTimeline(events, 20),
  };
}

export type JobOverview = NonNullable<Awaited<ReturnType<typeof loadJobOverview>>>;

function humanize(s: string): string {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
