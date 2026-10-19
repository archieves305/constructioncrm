import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { AiError, defaultModel, isAiConfigured } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { assigneeFor } from "@/lib/permits/alert-run";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { addDayKeys, pinAllDay, todayKey } from "@/lib/time/zone";
import { tickHeldFacts } from "@/lib/workflows/gates";
import { listPermitProducts } from "./approvals";
import { dictKey } from "./data-dictionary";
import { listFills, loadFormContext } from "./fills";
import { aiFindings, preflightTaskKey, PREFLIGHT_RULES_VERSION, runPreflight, score, type Finding, type PreflightContext } from "./preflight";
import * as review from "./prompts/preflight-review";
import { loadPermitDetail, PermitIntelError } from "./service";

/**
 * Running preflight on a permit, keeping each run, turning findings into
 * tasks on request, and the "ready to submit" mark. A permit is marked ready
 * with no blockers, or by an ADMIN / MANAGER override with a reason; freezing
 * a package clears it, so every submission is checked again.
 */
type Actor = { id: string; role: RoleName };

async function buildContext(permitId: string) {
  const detail = await loadPermitDetail(permitId);
  if (!detail) throw new PermitIntelError(404, "Permit not found");
  const { permit, files, checklist } = detail;
  const [forms, products, formCtx, notices] = await Promise.all([
    listFills(permitId),
    listPermitProducts(permitId),
    loadFormContext(permitId),
    prisma.permitCorrectionNotice.findMany({
      where: { permitId },
      orderBy: { receivedAt: "asc" },
      select: { status: true, confirmedAt: true, cycle: { select: { number: true } }, items: { where: { status: { not: "PROPOSED" } }, select: { status: true, text: true } } },
    }),
  ]);
  const latest = permit.cycles[0] ?? null;
  const latestNotices = notices.filter((n) => latest && n.cycle.number === latest.number);
  const lastConfirmed = [...latestNotices].reverse().find((n) => n.confirmedAt)?.confirmedAt ?? null;
  const license = dictKey("contractor.licenseNumber")!.resolve(formCtx).value;
  const qualifier = dictKey("contractor.qualifierName")!.resolve(formCtx).value;
  const ctx: PreflightContext = {
    permit: { hasJurisdiction: !!permit.jurisdictionId, permitTypeKey: permit.permitTypeKey, valuation: permit.valuation == null ? null : Number(permit.valuation), currentCycle: permit.currentCycle, jurisdictionHvhz: !!permit.jurisdiction?.hvhz },
    property: { parcelNumber: formCtx.lead.parcelNumber },
    checklist: checklist.map((l) => ({ id: l.requirement.id, title: l.requirement.title, documentType: l.requirement.documentType, required: l.requirement.required, met: l.met })),
    documentTypes: files.filter((f) => !f.missing).map((f) => f.permitDocType),
    forms: {
      available: forms.available.map((t) => ({ id: t.id, name: t.name })),
      fills: forms.fills.map((f) => ({
        templateId: f.templateId,
        name: f.template.name,
        status: f.status,
        problems: f.problems,
        missing: f.values.filter((v) => v.status === "MISSING").map((v) => v.label ?? v.field),
        signByHand: f.values.filter((v) => v.status === "SIGN_BY_HAND").map((v) => v.label ?? v.field),
      })),
    },
    products: products.map((p) => ({ id: p.id, label: p.label, flags: p.flags })),
    parties: permit.parties.map((p) => ({ role: p.role, name: p.name, licenseNumber: p.licenseNumber })),
    contractor: { licenseNumber: license, qualifierName: qualifier },
    cycle: {
      latestOutcome: latest?.outcome ?? null,
      latestHasSubmission: !!latest?.submission || !!latest?.submittedAt,
      noticeToConfirm: notices.some((n) => n.status === "REVIEW" || (n.status === "FAILED" && n.items.length === 0 && n.cycle.number === latest?.number)),
      openCorrections: latestNotices.flatMap((n) => n.items).filter((i) => i.status === "OPEN" || i.status === "WAITING_THIRD_PARTY" || i.status === "DISPUTED").length,
      responseLetterSinceNotice: !!lastConfirmed && files.some((f) => f.permitDocType === "correction_response" && new Date(f.createdAt) >= lastConfirmed),
    },
  };
  const reviewInput: review.ReviewInput = {
    jurisdiction: permit.jurisdiction?.name ?? permit.municipality,
    hvhz: !!permit.jurisdiction?.hvhz,
    permitType: permit.permitType,
    scope: permit.scopeDescription ?? null,
    documents: files.filter((f) => !f.missing).map((f) => ({ name: f.fileName, docType: f.permitDocType })),
    priorComments: notices.flatMap((n) => n.items.map((i) => i.text)),
  };
  return { ctx, reviewInput, permit };
}

export async function runPermitPreflight(permitId: string, opts: { ai?: boolean }, actor: Actor) {
  const { ctx, reviewInput, permit } = await buildContext(permitId);
  const findings: Finding[] = runPreflight(ctx);
  let aiCallId: string | null = null;
  if (opts.ai) {
    if (!isAiConfigured()) {
      findings.push({ code: "ai.unavailable", severity: "INFO", message: "AI review not run: AI is not set up on this server", source: "ai" });
    } else {
      const s = review.summary(ctx, reviewInput, findings.filter((f) => f.severity !== "INFO").map((f) => f.message));
      try {
        const r = await runAiCall({
          subjectType: "permit",
          subjectId: permitId,
          purpose: review.PURPOSE,
          promptVersion: review.PROMPT_VERSION,
          schema: review.schema,
          inputs: { summary: s.text },
          system: review.SYSTEM,
          content: s.text,
          model: defaultModel(),
          effort: "medium",
          maxTokens: 8_000,
          userId: actor.id,
        });
        aiCallId = r.callId;
        findings.push(...aiFindings(r.output, s.refs));
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        findings.push({ code: "ai.failed", severity: "INFO", message: `AI review not run: ${err.message}`, source: "ai" });
      }
    }
  }
  const sc = score(findings);
  const run = await prisma.permitPreflightRun.create({
    data: { permitId, cycleNumber: permit.currentCycle, rulesVersion: PREFLIGHT_RULES_VERSION, ...sc, findings: findings as unknown as Prisma.InputJsonValue, aiCallId, ranByUserId: actor.id },
  });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: permitId, action: "preflight_run", after: { runId: run.id, ...sc, ai: !!opts.ai } });
  await settlePreflightTasks(permitId, findings, actor.id);
  return presentRun(run);
}

const presentRun = <T extends { findings: unknown }>(r: T) => ({ ...r, findings: r.findings as Finding[] });

export async function listRuns(permitId: string) {
  const runs = await prisma.permitPreflightRun.findMany({ where: { permitId }, orderBy: { createdAt: "desc" }, take: 20, include: { ranBy: { select: { firstName: true, lastName: true } } } });
  return runs.map(presentRun);
}

/** A check that no longer fails closes its task. Never throws. */
async function settlePreflightTasks(permitId: string, findings: readonly Finding[], actorUserId: string) {
  try {
    const live = new Set(findings.filter((f) => f.severity !== "INFO").map((f) => preflightTaskKey(permitId, f.code)));
    const open = await prisma.task.findMany({ where: { sourceKey: { startsWith: `preflight:${permitId}:` }, status: { in: [...OPEN_TASK_STATUSES] } }, select: { sourceKey: true } });
    for (const key of new Set(open.map((t) => t.sourceKey as string))) {
      if (!live.has(key)) await closeAutoTask(key, { actorUserId, outcome: "COMPLETED", because: "The next preflight passed this check" });
    }
  } catch (err) {
    logger.exception(err, { where: "preflight.settleTasks", permitId });
  }
}

/** Tasks for the findings a person picked, for the permit's coordinator — once per rule. */
export async function createPreflightTasks(runId: string, codes: string[], actor: Actor) {
  const run = await prisma.permitPreflightRun.findUnique({ where: { id: runId }, select: { permitId: true, findings: true, permit: { select: { id: true, jobId: true, assignedUserId: true, permitType: true, municipality: true, job: { select: { projectManagerId: true } } } } } });
  if (!run) throw new PermitIntelError(404, "Preflight run not found");
  const findings = (run.findings as unknown as Finding[]).filter((f) => codes.includes(f.code) && f.severity !== "INFO");
  if (!findings.length) throw new PermitIntelError(400, "Pick at least one blocker or warning");
  const p = run.permit;
  const assignee = await assigneeFor("coordinator", { jobId: p.jobId, permitId: p.id, assignedUserId: p.assignedUserId, projectManagerId: p.job.projectManagerId });
  if (!assignee) throw new PermitIntelError(409, "Nobody to give the tasks to: set the permit's coordinator");
  let created = 0;
  for (const f of findings) {
    const key = preflightTaskKey(p.id, f.code);
    if (await prisma.task.findFirst({ where: { sourceKey: key, status: { in: [...OPEN_TASK_STATUSES] } }, select: { id: true } })) continue;
    await createTask(
      {
        title: f.message.slice(0, 200),
        description: [`Preflight on the ${p.permitType ?? "permit"} (${p.municipality}).`, f.suggestion ?? null, "It closes by itself when a later preflight passes this check."].filter(Boolean).join("\n\n"),
        priority: f.severity === "BLOCKER" ? "HIGH" : "MEDIUM",
        dueAt: pinAllDay(addDayKeys(todayKey(), f.severity === "BLOCKER" ? 2 : 5)),
        allDay: true,
        assignedUserId: assignee,
        createdByUserId: actor.id,
        jobId: p.jobId,
        permitId: p.id,
        source: "auto",
        sourceKey: key,
      },
      { actorUserId: actor.id, notify: "inline" },
    );
    created++;
  }
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: p.id, action: "preflight_tasks", after: { runId, codes, created } });
  return { created };
}

const canOverride = (role: RoleName | string) => role === "ADMIN" || role === "MANAGER";

/**
 * Mark the permit ready to submit. A fresh preflight is run first (rules
 * only); blockers need an ADMIN / MANAGER override with a reason. The job's
 * "Assemble … permit documents" step ticks itself.
 */
export async function markReady(permitId: string, input: { overrideReason?: string | null }, actor: Actor) {
  const run = await runPermitPreflight(permitId, { ai: false }, actor);
  const reason = input.overrideReason?.trim() || null;
  if (run.blockers > 0) {
    if (!reason) throw new PermitIntelError(409, `${run.blockers} blocker${run.blockers === 1 ? " stands" : "s stand"} in the way. Fix ${run.blockers === 1 ? "it" : "them"}, or an administrator or manager overrides with a reason.`);
    if (!canOverride(actor.role)) throw new PermitIntelError(403, "Only an administrator or a manager may mark a permit ready over its blockers");
    if (reason.length < 10) throw new PermitIntelError(400, "Say why the blockers do not apply (at least a sentence)");
  }
  const permit = await prisma.jobPermit.update({ where: { id: permitId }, data: { readyAt: new Date(), readyByUserId: actor.id, readyRunId: run.id, readyOverride: run.blockers > 0 ? reason : null }, select: { jobId: true } });
  await recordAudit({ actorUserId: actor.id, entityType: "JobPermit", entityId: permitId, action: run.blockers > 0 ? "preflight_override" : "permit_ready", after: { runId: run.id, score: run.score, blockers: run.blockers, reason: run.blockers > 0 ? reason : undefined } });
  await tickHeldFacts(permit.jobId, actor.id);
  return run;
}

export async function clearReady(permitId: string, actor: Actor | null, because: string) {
  const p = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { readyAt: true } });
  if (!p?.readyAt) return;
  await prisma.jobPermit.update({ where: { id: permitId }, data: { readyAt: null, readyByUserId: null, readyRunId: null, readyOverride: null } });
  await recordAudit({ actorUserId: actor?.id ?? null, entityType: "JobPermit", entityId: permitId, action: "permit_ready_cleared", after: { because } });
}

/** The run as a PDF report for the permit's file. */
export async function preflightReport(runId: string) {
  const { renderPreflightReportPdf } = await import("@/lib/pdf/permit-preflight-report");
  const { formatAddressLine } = await import("@/lib/labels/address");
  const { SCORE_LABEL } = await import("./preflight");
  const run = await prisma.permitPreflightRun.findUnique({
    where: { id: runId },
    include: {
      ranBy: { select: { firstName: true, lastName: true } },
      permit: { select: { id: true, permitType: true, municipality: true, readyRunId: true, readyOverride: true, job: { select: { lead: { select: { propertyAddress1: true, propertyAddress2: true, city: true, state: true, zipCode: true } } } } } },
    },
  });
  if (!run) throw new PermitIntelError(404, "Preflight run not found");
  const pdf = await renderPreflightReportPdf({
    date: run.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "short" }),
    address: formatAddressLine(run.permit.job.lead) || "—",
    permit: `${run.permit.permitType ?? "Permit"}`,
    jurisdiction: run.permit.municipality,
    cycle: run.cycleNumber,
    score: run.score,
    blockers: run.blockers,
    warnings: run.warnings,
    scoreLabel: SCORE_LABEL,
    rulesVersion: run.rulesVersion,
    ranBy: run.ranBy ? `${run.ranBy.firstName} ${run.ranBy.lastName}`.trim() : null,
    ready: run.permit.readyRunId === run.id ? (run.permit.readyOverride ? `Marked ready over its blockers: ${run.permit.readyOverride}` : "Marked ready to submit") : null,
    findings: run.findings as unknown as Finding[],
  });
  return { pdf, fileName: `Permit readiness - ${run.permit.municipality} - ${run.createdAt.toISOString().slice(0, 10)}.pdf` };
}
