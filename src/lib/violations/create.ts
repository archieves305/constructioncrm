import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { parseDueAt } from "@/lib/tasks/dates";
import type { CreateCaseBody } from "@/lib/validators/violation";
import { auditCase } from "./audit";
import { nextCaseNumber } from "./case-number";
import { ViolationError } from "./errors";
import { recordCaseEvents, type CaseEventInput } from "./events";
import { applyCaseWorkflow } from "./workflow";

const d = (v: string | null | undefined): Date | null => (v ? parseDueAt(v) : null);

/**
 * Intake. The case, its items, the first hearing and the opening ledger
 * entries are one transaction; the workflow is applied right after (the
 * engine owns its own transaction and is idempotent, so a failed apply
 * leaves a NEW case that the Workflow tab can apply from).
 */
export async function createCase(body: CreateCaseBody, actor: { id: string; role: RoleName }) {
  const lead = await prisma.lead.findUnique({ where: { id: body.leadId }, select: { id: true, fullName: true } });
  if (!lead) throw new ViolationError(400, "That property (lead) does not exist");
  if (body.jobId) {
    const job = await prisma.job.findUnique({ where: { id: body.jobId }, select: { leadId: true } });
    if (!job) throw new ViolationError(400, "That job does not exist");
    if (job.leadId !== body.leadId) throw new ViolationError(400, "The job belongs to a different property");
  }
  const categoryIds = Array.from(new Set(body.items.flatMap((i) => (i.categoryId ? [i.categoryId] : []))));
  if (categoryIds.length > 0) {
    const n = await prisma.codeViolationCategory.count({ where: { id: { in: categoryIds } } });
    if (n !== categoryIds.length) throw new ViolationError(400, "Unknown violation category");
  }
  const now = new Date();
  const deadline = d(body.complianceDeadline);
  const hearingAt = body.hearingAt ? new Date(body.hearingAt) : null;
  const dailyFine = body.fines?.dailyFine ?? null;
  const lienRecorded = Boolean(body.lien?.recorded);

  const created = await prisma.$transaction(async (tx) => {
    const caseNumber = await nextCaseNumber(tx);
    const c = await tx.codeViolationCase.create({
      data: {
        caseNumber,
        title: body.title,
        agencyCaseNumber: body.agencyCaseNumber ?? null,
        leadId: body.leadId,
        jobId: body.jobId ?? null,
        parcelNumber: body.parcelNumber ?? null,
        ownerNameSnapshot: body.ownerNameSnapshot ?? lead.fullName,
        jurisdiction: body.jurisdiction ?? null,
        department: body.department ?? null,
        officerName: body.officerName ?? null,
        officerPhone: body.officerPhone ?? null,
        officerEmail: body.officerEmail ?? null,
        noticeType: body.noticeType ?? null,
        summary: body.summary ?? null,
        receivedAt: d(body.receivedAt) ?? now,
        noticeDate: d(body.noticeDate),
        originalDeadline: deadline,
        currentDeadline: deadline,
        appealDeadline: d(body.appealDeadline),
        nextHearingAt: hearingAt,
        status: "NEW",
        priority: body.priority ?? "MEDIUM",
        severity: body.severity ?? "MODERATE",
        caseManagerId: body.caseManagerId ?? null,
        responsibleRole: body.responsibleRole ?? null,
        hearingRequired: body.hearingRequired ?? hearingAt !== null,
        reinspectionRequired: body.reinspectionRequired ?? true,
        emergency: body.emergency ?? false,
        constructionRequired: body.constructionRequired ?? false,
        estimatedCost: body.estimatedCost ?? null,
        initialFine: body.fines?.initialFine ?? null,
        dailyFine,
        fineAccrualStartDate: d(body.fines?.accrualStartDate),
        fineTermsUpdatedAt: body.fines ? now : null,
        lienStatus: lienRecorded ? "RECORDED" : "NONE",
        lienAmount: lienRecorded ? (body.lien?.amount ?? null) : null,
        lienRecordedAt: lienRecorded ? (d(body.lien?.recordedAt) ?? now) : null,
        lienInstrumentNumber: lienRecorded ? (body.lien?.instrumentNumber ?? null) : null,
        createdByUserId: actor.id,
      },
    });
    const events: CaseEventInput[] = [{ caseId: c.id, actorUserId: actor.id, type: "CREATED", body: `${caseNumber} opened${body.noticeType ? ` — ${body.noticeType.toLowerCase().replace(/_/g, " ")}` : ""}` }];
    for (const [i, item] of body.items.entries()) {
      const row = await tx.codeViolationItem.create({
        data: {
          caseId: c.id,
          itemNumber: i + 1,
          categoryId: item.categoryId ?? null,
          codeSection: item.codeSection ?? null,
          description: item.description,
          correctiveAction: item.correctiveAction ?? null,
          responsibleTrade: item.responsibleTrade ?? null,
          permitRequirement: item.permitRequirement ?? "UNDETERMINED",
          assignedUserId: item.assignedUserId ?? null,
          assignedRole: item.assignedRole ?? null,
          contractorName: item.contractorName ?? null,
          targetCompletionAt: d(item.targetCompletionAt),
          estimatedCost: item.estimatedCost ?? null,
          sortOrder: (i + 1) * 10,
        },
      });
      events.push({ caseId: c.id, itemId: row.id, actorUserId: actor.id, type: "ITEM_ADDED", body: `Item ${i + 1}: ${item.description.slice(0, 120)}` });
    }
    if (hearingAt) {
      await tx.codeViolationHearing.create({ data: { caseId: c.id, scheduledAt: hearingAt, location: body.hearingLocation ?? null, createdByUserId: actor.id } });
      events.push({ caseId: c.id, actorUserId: actor.id, type: "HEARING_SCHEDULED", toValue: hearingAt.toISOString() });
    }
    const ledger: Prisma.CodeViolationFineEntryCreateManyInput[] = [];
    if (dailyFine && Number(dailyFine) > 0) {
      ledger.push({ caseId: c.id, type: "ACCRUAL_STARTED", amount: dailyFine, effectiveAt: d(body.fines?.accrualStartDate) ?? now, notes: "Daily fine from the notice", createdByUserId: actor.id });
      events.push({ caseId: c.id, actorUserId: actor.id, type: "FINE_ENTRY", body: `Daily fine $${Number(dailyFine).toLocaleString()} accruing` });
    }
    if (body.fines?.initialFine && Number(body.fines.initialFine) > 0) {
      ledger.push({ caseId: c.id, type: "FINE_IMPOSED", amount: body.fines.initialFine, effectiveAt: d(body.noticeDate) ?? now, notes: "Initial fine from the notice", createdByUserId: actor.id });
    }
    if (lienRecorded) {
      ledger.push({ caseId: c.id, type: "LIEN_RECORDED", amount: body.lien?.amount ?? null, effectiveAt: d(body.lien?.recordedAt) ?? now, reference: body.lien?.instrumentNumber ?? null, createdByUserId: actor.id });
      events.push({ caseId: c.id, actorUserId: actor.id, type: "LIEN_RECORDED", body: body.lien?.instrumentNumber ?? null });
    }
    if (ledger.length > 0) await tx.codeViolationFineEntry.createMany({ data: ledger });
    await recordCaseEvents(tx, events);
    return c;
  });

  await auditCase({
    actorUserId: actor.id,
    entityType: "CodeViolationCase",
    entityId: created.id,
    action: "violation_case_create",
    after: { caseNumber: created.caseNumber, leadId: body.leadId, jobId: body.jobId ?? null, jurisdiction: body.jurisdiction ?? null, noticeType: body.noticeType ?? null, items: body.items.length, complianceDeadline: body.complianceDeadline ?? null, templateKey: body.workflow?.templateKey ?? null },
  });

  let tasksCreated = 0;
  let workflowWarning: string | null = null;
  if (body.workflow?.templateKey) {
    try {
      const r = await applyCaseWorkflow(
        created.id,
        {
          templateKey: body.workflow.templateKey,
          permitStatus: body.workflow.permitStatus,
          scopeToggles: body.workflow.scopeToggles,
          team: body.workflow.team,
          jurisdiction: body.jurisdiction ?? null,
          permitNotes: body.workflow.permitNotes ?? null,
        },
        actor,
      );
      tasksCreated = r.created;
    } catch (err) {
      workflowWarning = err instanceof Error ? err.message : "The workflow could not be applied";
      logger.exception(err, { where: "violations.createCase.apply", caseId: created.id });
    }
  }
  return { id: created.id, caseNumber: created.caseNumber, tasksCreated, workflowWarning };
}
