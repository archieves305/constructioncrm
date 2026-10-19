import { Prisma, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { isAiConfigured } from "@/lib/ai/client";
import { JOB_LABEL_SELECT } from "@/lib/labels/select";
import { logger } from "@/lib/logger";
import type { CorrectionCategory, CorrectionTarget } from "./corrections-plan";
import { applicableLessons, fallbackLesson, lessonCheckSchema, planLessons, scrub, type Generalised, type LessonRow } from "./lessons";
import * as gen from "./prompts/lesson-generalise";
import { PermitIntelError } from "./service";

/**
 * The knowledge the module learns: lessons from corrections the department
 * accepted. Proposed as soon as the outcomes are known, decided by an
 * administrator, shown at preflight. Requirements (Stage 1) live in the same
 * table and are edited under Admin → Permits → Requirements.
 */
type Actor = { id: string; role: RoleName };

/**
 * After the department's next answer gave this permit's comments their
 * outcome: each accepted comment joins its lesson (or proposes a new one).
 * Never throws — learning must not stop the permit's own work.
 */
export async function proposeLessonsFor(permitId: string): Promise<{ created: number; bumped: number }> {
  try {
    const permit = await prisma.jobPermit.findUnique({
      where: { id: permitId },
      select: { jurisdictionId: true, permitTypeKey: true, permitType: true, municipality: true, permitNumber: true, applicationNumber: true, jurisdiction: { select: { name: true } }, parties: { select: { name: true } }, job: { select: { jobNumber: true, lead: { select: { fullName: true, propertyAddress1: true, parcelNumber: true } } } } },
    });
    if (!permit) return { created: 0, bumped: 0 };
    const items = await prisma.permitCorrectionItem.findMany({ where: { permitId, reviewOutcome: "ACCEPTED", status: { not: "PROPOSED" } }, select: { id: true, permitId: true, category: true, affects: true, text: true } });
    if (!items.length) return { created: 0, bumped: 0 };
    const existing = await prisma.permitKnowledge.findMany({ where: { kind: "LESSON" }, select: { id: true, groupKey: true, status: true, sourceItemIds: true } });
    const plan = planLessons(
      items.map((i) => ({ ...i, jurisdictionId: permit.jurisdictionId, permitTypeKey: permit.permitTypeKey })),
      existing,
    );
    const terms = [permit.job.lead.propertyAddress1, permit.job.lead.fullName, permit.job.lead.parcelNumber, permit.permitNumber, permit.applicationNumber, permit.job.jobNumber, ...permit.parties.map((p) => p.name)];
    const now = new Date();
    for (const b of plan.bump) {
      await prisma.permitKnowledge.update({ where: { id: b.lessonId }, data: { occurrences: { increment: b.itemIds.length }, sourceItemIds: { push: b.itemIds }, lastSeenAt: now } });
    }
    for (const c of plan.create) {
      const comments = c.items.map((i) => scrub(i.text, terms));
      let lesson: Generalised = fallbackLesson(comments);
      let aiCallId: string | null = null;
      if (isAiConfigured()) {
        try {
          const ctx = { jurisdiction: permit.jurisdiction?.name ?? permit.municipality, permitType: permit.permitType, category: c.category as CorrectionCategory, target: c.target as CorrectionTarget, comments };
          const r = await runAiCall({ subjectType: "permit", subjectId: permitId, purpose: gen.PURPOSE, promptVersion: gen.PROMPT_VERSION, schema: gen.schema, inputs: ctx, system: gen.SYSTEM, content: gen.content(ctx), model: gen.MODEL, effort: "low", maxTokens: 2_000 });
          lesson = r.output;
          aiCallId = r.callId;
        } catch (err) {
          logger.warn("lesson not generalised; kept as written", { permitId, message: err instanceof Error ? err.message : String(err) });
        }
      }
      await prisma.permitKnowledge.create({
        data: {
          kind: "LESSON",
          status: "PROPOSED",
          reliability: "OBSERVED",
          jurisdictionId: c.jurisdictionId,
          permitTypeKey: c.permitTypeKey,
          title: scrub(lesson.title, terms).slice(0, 200),
          body: scrub(lesson.body, terms).slice(0, 4000),
          category: c.category,
          target: c.target,
          groupKey: c.groupKey,
          sourceItemIds: c.items.map((i) => i.id),
          occurrences: c.items.length,
          lastSeenAt: now,
          required: false,
          check: lesson.requiresDocType ? ({ requiresDocType: lesson.requiresDocType } as Prisma.InputJsonValue) : undefined,
          aiCallId,
        },
      });
    }
    return { created: plan.create.length, bumped: plan.bump.length };
  } catch (err) {
    logger.exception(err, { where: "knowledge.proposeLessonsFor", permitId });
    return { created: 0, bumped: 0 };
  }
}

/** The lessons for Admin → Permits → Knowledge, with the comments they came from and how often they came up since approval. */
export async function listLessons() {
  const lessons = await prisma.permitKnowledge.findMany({
    where: { kind: "LESSON" },
    orderBy: [{ status: "asc" }, { occurrences: "desc" }, { updatedAt: "desc" }],
    include: { jurisdiction: { select: { id: true, name: true } }, decidedBy: { select: { firstName: true, lastName: true } } },
  });
  const itemIds = [...new Set(lessons.flatMap((l) => l.sourceItemIds))];
  const items = itemIds.length
    ? await prisma.permitCorrectionItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, text: true, reviewerItemNumber: true, notice: { select: { receivedAt: true } }, permit: { select: { id: true, permitType: true, job: { select: JOB_LABEL_SELECT } } } } })
    : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return lessons.map((l) => {
    const src = l.sourceItemIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const after = l.status === "APPROVED" && l.decidedAt ? src.filter((s) => s.notice.receivedAt > l.decidedAt!).length : null;
    return { ...l, sources: src, seenBeforeApproval: after == null ? src.length : src.length - after, seenSinceApproval: after };
  });
}

export type LessonDecision = { status?: "APPROVED" | "REJECTED" | "RETIRED" | "PROPOSED"; title?: string; body?: string | null; check?: { requiresDocType: string } | null; jurisdictionId?: string | null; permitTypeKey?: string | null };

export async function decideLesson(id: string, d: LessonDecision, actor: Actor) {
  const before = await prisma.permitKnowledge.findUnique({ where: { id }, select: { kind: true, status: true, title: true } });
  if (!before || before.kind !== "LESSON") throw new PermitIntelError(404, "Lesson not found");
  if (d.check !== undefined && !lessonCheckSchema.safeParse(d.check).success) throw new PermitIntelError(400, "Unknown document type for the check");
  if (d.jurisdictionId && !(await prisma.jurisdiction.findUnique({ where: { id: d.jurisdictionId }, select: { id: true } }))) throw new PermitIntelError(400, "That jurisdiction does not exist");
  const data: Prisma.PermitKnowledgeUncheckedUpdateInput = {};
  if (d.title !== undefined) data.title = d.title.trim().slice(0, 200);
  if (d.body !== undefined) data.body = d.body?.trim() || null;
  if (d.check !== undefined) data.check = d.check ? (d.check as Prisma.InputJsonValue) : Prisma.DbNull;
  if (d.jurisdictionId !== undefined) data.jurisdictionId = d.jurisdictionId;
  if (d.permitTypeKey !== undefined) data.permitTypeKey = d.permitTypeKey;
  if (d.status && d.status !== before.status) Object.assign(data, { status: d.status, decidedByUserId: actor.id, decidedAt: new Date() });
  const l = await prisma.permitKnowledge.update({ where: { id }, data });
  await recordAudit({ actorUserId: actor.id, entityType: "PermitKnowledge", entityId: id, action: d.status && d.status !== before.status ? `lesson_${d.status.toLowerCase()}` : "lesson_edit", before: { status: before.status, title: before.title }, after: { status: l.status, title: l.title, check: l.check } });
  return l;
}

/** The approved lessons for one permit, for preflight. */
export async function lessonsForPermit(permit: { jurisdictionId: string | null; permitTypeKey: string | null }): Promise<LessonRow[]> {
  const rows = await prisma.permitKnowledge.findMany({
    where: { kind: "LESSON", status: "APPROVED", OR: [{ jurisdictionId: null }, ...(permit.jurisdictionId ? [{ jurisdictionId: permit.jurisdictionId }] : [])] },
    select: { id: true, status: true, kind: true, jurisdictionId: true, permitTypeKey: true, title: true, body: true, check: true, occurrences: true, effectiveFrom: true, effectiveTo: true, lastSeenAt: true },
  });
  return applicableLessons(rows, permit, new Date()).slice(0, 15);
}
