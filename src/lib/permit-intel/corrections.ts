import { createHash } from "node:crypto";
import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { AI_NOT_CONFIGURED, AiError, defaultModel, isAiConfigured } from "@/lib/ai/client";
import { readPdfText, joinPages } from "@/lib/files/pdf-text";
import { readFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { assigneeFor } from "@/lib/permits/alert-run";
import { closeAutoTask } from "@/lib/tasks/auto-tasks";
import { createTask } from "@/lib/tasks/create";
import { OPEN_TASK_STATUSES } from "@/lib/tasks/status";
import { updateTask } from "@/lib/tasks/update";
import { dayKey, pinAllDay, type DayKey } from "@/lib/time/zone";
import {
  canMoveTo,
  correctionItemKey,
  correctionsReceivedKey,
  earlierOutcomes,
  isClosedStatus,
  isStaleExtraction,
  itemTask,
  MAX_EXTRACT_ATTEMPTS,
  proposedItems,
  resubmitDueDay,
  resubmitKey,
  STALE_EXTRACT_MS,
  statedDeadlineDay,
  statusOnConfirm,
  type CorrectionStatus,
} from "./corrections-plan";
import type { ItemCreateInput, ItemPatchInput, NoticeCreateInput } from "./correction-validation";
import * as extract from "./prompts/correction-extract";
import { proposeLessonsFor } from "./knowledge";
import { PermitIntelError, recordCycleOutcome } from "./service";

/**
 * Corrections: a building department's notice read into items, the items
 * confirmed by a person, then worked as tasks until the corrected package
 * goes back. The AI's reading is a proposal — the notice, its items and the
 * permit move only when someone confirms. Every write is audited on the
 * permit (`JobPermit`).
 */
type Actor = { id: string; role: RoleName };

const audit = (actor: { id: string } | null, permitId: string, action: string, before?: unknown, after?: unknown) =>
  recordAudit({ actorUserId: actor?.id ?? null, entityType: "JobPermit", entityId: permitId, action, before, after });

/** "Re-Roof permit (City of Palm Beach)" — how tasks name the permit. */
export function permitLabelOf(p: { permitType: string | null; municipality: string }): string {
  const type = p.permitType?.trim();
  return `${type ? `${type}${/permit$/i.test(type) ? "" : " permit"}` : "permit"} (${p.municipality})`;
}

const PERMIT_OWNER_SELECT = { id: true, jobId: true, assignedUserId: true, permitType: true, municipality: true, job: { select: { projectManagerId: true } } } as const;
type PermitOwnerRow = { id: string; jobId: string; assignedUserId: string | null; permitType: string | null; municipality: string; job: { projectManagerId: string | null } };
const ownerOf = (p: PermitOwnerRow) => ({ jobId: p.jobId, permitId: p.id, assignedUserId: p.assignedUserId, projectManagerId: p.job.projectManagerId });

/** One task per source key, ever — closing it does not bring it back. */
async function raiseOnce(p: PermitOwnerRow, t: { sourceKey: string; title: string; description: string; priority: "HIGH" | "MEDIUM" | "URGENT"; dueDay: DayKey; audience: "coordinator" | "manager" }): Promise<string | null> {
  const seen = await prisma.task.findFirst({ where: { sourceKey: t.sourceKey }, select: { id: true } });
  if (seen) return seen.id;
  const assignee = await assigneeFor(t.audience, ownerOf(p));
  if (!assignee) return null;
  const task = await createTask(
    { title: t.title, description: t.description, priority: t.priority, dueAt: pinAllDay(t.dueDay), allDay: true, assignedUserId: assignee, createdByUserId: assignee, jobId: p.jobId, permitId: p.id, source: "auto", sourceKey: t.sourceKey },
    { actorUserId: null, notify: "inline" },
  );
  return task.id;
}

// ─── Notices ────────────────────────────────────────────────────────────────

const READABLE_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** The API takes a request of 32 MB; base64 grows a file by a third. */
const MAX_NOTICE_BYTES = 22 * 1024 * 1024;

export async function createNotice(permitId: string, input: NoticeCreateInput, actor: Actor) {
  const permit = await prisma.jobPermit.findUnique({
    where: { id: permitId },
    select: { ...PERMIT_OWNER_SELECT, cycles: { orderBy: { number: "desc" }, take: 1, select: { id: true, number: true, outcome: true } } },
  });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const cycle = permit.cycles[0];
  if (!cycle) throw new PermitIntelError(409, "No submission is on record for this permit. Record the submission the notice answers first (Submissions tab).");
  if (cycle.outcome !== "PENDING" && cycle.outcome !== "CORRECTIONS") {
    throw new PermitIntelError(409, `Review cycle ${cycle.number} is recorded as ${cycle.outcome.toLowerCase()}. A correction notice answers a cycle that is waiting on the department or already has corrections.`);
  }
  if (input.source === "UPLOAD") {
    const file = await prisma.file.findUnique({ where: { id: input.fileId! }, select: { id: true, permitId: true, fileType: true, permitDocType: true } });
    if (!file || file.permitId !== permitId) throw new PermitIntelError(400, "The notice must be one of this permit's documents");
    if (file.fileType !== "application/pdf" && !READABLE_IMAGE.has(file.fileType)) throw new PermitIntelError(400, "Only a PDF or a picture of the notice can be read. Paste its text instead.");
    if (!file.permitDocType) await prisma.file.update({ where: { id: file.id }, data: { permitDocType: "correction_notice" } });
  }
  const aiReady = isAiConfigured();
  const notice = await prisma.permitCorrectionNotice.create({
    data: {
      permitId,
      cycleId: cycle.id,
      fileId: input.source === "UPLOAD" ? input.fileId! : null,
      source: input.source,
      rawText: input.source === "PASTE" ? input.text!.trim() : null,
      receivedAt: input.receivedAt ?? new Date(),
      reviewerName: input.reviewerName ?? null,
      status: aiReady ? "EXTRACTING" : "FAILED",
      error: aiReady ? null : `${AI_NOT_CONFIGURED}. Type the items by hand.`,
      createdByUserId: actor.id,
    },
  });
  await audit(actor, permitId, "correction_notice_add", undefined, { noticeId: notice.id, cycle: cycle.number, source: notice.source, fileId: notice.fileId });
  try {
    await raiseOnce(permit, {
      sourceKey: correctionsReceivedKey(permitId, cycle.number),
      title: `Review the corrections on the ${permitLabelOf(permit)}`,
      description: `The building department sent corrections on review cycle ${cycle.number}. Check the items read from the notice on the permit's Corrections tab and confirm them.`,
      priority: "HIGH",
      dueDay: dayKey(new Date()),
      audience: "manager",
    });
  } catch (err) {
    logger.exception(err, { where: "corrections.createNotice.task", permitId });
  }
  return notice;
}

export async function updateNotice(noticeId: string, patch: { receivedAt?: Date; reviewerName?: string | null; responseDueAt?: Date | null }, actor: Actor) {
  const before = await prisma.permitCorrectionNotice.findUnique({ where: { id: noticeId }, select: { id: true, permitId: true, receivedAt: true, reviewerName: true, responseDueAt: true } });
  if (!before) throw new PermitIntelError(404, "Notice not found");
  const n = await prisma.permitCorrectionNotice.update({ where: { id: noticeId }, data: patch });
  await audit(actor, before.permitId, "correction_notice_update", { receivedAt: before.receivedAt, reviewerName: before.reviewerName, responseDueAt: before.responseDueAt }, { receivedAt: n.receivedAt, reviewerName: n.reviewerName, responseDueAt: n.responseDueAt });
  return n;
}

/** A notice not yet confirmed can be removed (its file stays on the permit). */
export async function deleteNotice(noticeId: string, actor: Actor) {
  const n = await prisma.permitCorrectionNotice.findUnique({ where: { id: noticeId }, select: { id: true, permitId: true, status: true, fileId: true } });
  if (!n) throw new PermitIntelError(404, "Notice not found");
  if (n.status === "CONFIRMED") throw new PermitIntelError(409, "A confirmed notice cannot be removed: its items are tasks now. Waive the items instead.");
  await prisma.permitCorrectionNotice.delete({ where: { id: noticeId } });
  await audit(actor, n.permitId, "correction_notice_delete", { noticeId, status: n.status, fileId: n.fileId });
}

/** Read the notice again (after a failure, or to replace the proposed items). */
export async function requestReread(noticeId: string, actor: Actor) {
  const n = await prisma.permitCorrectionNotice.findUnique({ where: { id: noticeId }, select: { id: true, permitId: true, status: true } });
  if (!n) throw new PermitIntelError(404, "Notice not found");
  if (n.status === "CONFIRMED") throw new PermitIntelError(409, "The notice is confirmed; its items are no longer the AI's to change");
  if (n.status === "EXTRACTING") throw new PermitIntelError(409, "The notice is being read now");
  if (!isAiConfigured()) throw new AiError(AI_NOT_CONFIGURED, 503, "not_configured");
  await prisma.permitCorrectionNotice.update({ where: { id: noticeId }, data: { status: "EXTRACTING", error: null, extractStartedAt: null, attempts: 0 } });
  await audit(actor, n.permitId, "correction_notice_reread", undefined, { noticeId });
}

function previousRef(cycleNumber: number, item: { reviewerItemNumber: string | null; sortOrder: number }): string {
  return `c${cycleNumber}-${item.reviewerItemNumber ?? `#${item.sortOrder + 1}`}`;
}

/**
 * The AI reads the notice. Runs after the response (`after()` in the route);
 * claims the notice first, so two runs never read it at once, and a run cut
 * off by a restart is taken up again once it is stale. Never throws: a
 * failure is written on the notice for the person to see.
 */
export async function runExtraction(noticeId: string, userId: string | null): Promise<void> {
  const now = new Date();
  const claim = await prisma.permitCorrectionNotice.updateMany({
    where: { id: noticeId, status: "EXTRACTING", attempts: { lt: MAX_EXTRACT_ATTEMPTS }, OR: [{ extractStartedAt: null }, { extractStartedAt: { lt: new Date(now.getTime() - STALE_EXTRACT_MS) } }] },
    data: { extractStartedAt: now, attempts: { increment: 1 } },
  });
  if (!claim.count) return;
  const fail = (error: string) => prisma.permitCorrectionNotice.update({ where: { id: noticeId }, data: { status: "FAILED", error: error.slice(0, 500) } });
  try {
    const n = await prisma.permitCorrectionNotice.findUniqueOrThrow({
      where: { id: noticeId },
      include: {
        cycle: { select: { number: true } },
        file: { select: { id: true, storageKey: true, fileType: true, fileName: true, fileSize: true, extractedText: true } },
        permit: { select: { id: true, municipality: true, permitType: true, applicationNumber: true, permitNumber: true, parties: { select: { id: true, name: true, role: true } } } },
      },
    });
    let notice: Parameters<typeof extract.content>[1];
    let pageCount: number | null = null;
    let fingerprint: string;
    if (n.file) {
      if (n.file.fileSize > MAX_NOTICE_BYTES) return void (await fail("The notice file is too large to read (over 22 MB). Paste its text, or upload only the pages with comments."));
      let bytes: Buffer;
      try {
        bytes = await readFile(n.file.storageKey);
      } catch {
        return void (await fail("The notice file is missing from the store. Upload it again."));
      }
      fingerprint = createHash("sha256").update(bytes).digest("hex");
      if (n.file.fileType === "application/pdf") {
        const text = await readPdfText(bytes);
        pageCount = text?.pageCount ?? null;
        if (text && n.file.extractedText == null) await prisma.file.update({ where: { id: n.file.id }, data: { extractedText: joinPages(text) } });
        notice = { pdfBase64: bytes.toString("base64") };
      } else if (READABLE_IMAGE.has(n.file.fileType)) {
        notice = { imageBase64: bytes.toString("base64"), mediaType: n.file.fileType as "image/png" };
        pageCount = 1;
      } else {
        return void (await fail("Only a PDF or a picture of the notice can be read. Paste its text instead."));
      }
    } else {
      const text = n.rawText ?? "";
      fingerprint = createHash("sha256").update(text).digest("hex");
      notice = { text };
    }

    const previousItems = await prisma.permitCorrectionItem.findMany({
      where: { permitId: n.permitId, status: { not: "PROPOSED" }, notice: { cycle: { number: { lt: n.cycle.number } } } },
      orderBy: [{ notice: { receivedAt: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, reviewerItemNumber: true, sortOrder: true, text: true, notice: { select: { cycle: { select: { number: true } } } } },
    });
    const previous = previousItems.map((i) => ({ id: i.id, ref: previousRef(i.notice.cycle.number, i), text: i.text }));
    const ctx: extract.ExtractContext = {
      permit: { jurisdiction: n.permit.municipality, permitType: n.permit.permitType, applicationNumber: n.permit.applicationNumber, permitNumber: n.permit.permitNumber, cycle: n.cycle.number },
      parties: n.permit.parties.map((p) => ({ name: p.name, role: p.role })),
      previous: previous.map((p) => ({ ref: p.ref, text: p.text })),
    };
    const result = await runAiCall({
      subjectType: "correction_notice",
      subjectId: n.id,
      purpose: extract.PURPOSE,
      promptVersion: extract.PROMPT_VERSION,
      schema: extract.schema,
      inputs: { notice: fingerprint, ctx },
      system: extract.SYSTEM,
      content: extract.content(ctx, notice),
      model: defaultModel(),
      effort: "medium",
      maxTokens: 24_000,
      userId,
    });
    const rows = proposedItems(result.output, { parties: n.permit.parties, previous, pageCount });
    const deadline = statedDeadlineDay(result.output.statedDeadline, n.receivedAt);
    await prisma.$transaction(async (tx) => {
      // a re-read replaces what the AI proposed before; a person's confirmed rows are never touched
      await tx.permitCorrectionItem.deleteMany({ where: { noticeId: n.id, status: "PROPOSED" } });
      if (rows.length) await tx.permitCorrectionItem.createMany({ data: rows.map((r) => ({ ...r, noticeId: n.id, permitId: n.permitId, fromAi: true })) });
      await tx.permitCorrectionNotice.update({
        where: { id: n.id },
        data: {
          status: "REVIEW",
          error: null,
          summary: result.output.summary.slice(0, 4000),
          aiCallId: result.callId,
          reviewerName: n.reviewerName ?? (result.output.reviewerName?.trim().slice(0, 200) || null),
          responseDueAt: n.responseDueAt ?? (deadline ? pinAllDay(deadline) : null),
        },
      });
    });
  } catch (err) {
    if (err instanceof AiError) {
      await fail(err.message);
      return;
    }
    logger.exception(err, { where: "corrections.runExtraction", noticeId });
    await fail("The notice could not be read. Try again, or type the items by hand.").catch(() => undefined);
  }
}

const NOTICE_INCLUDE = {
  cycle: { select: { id: true, number: true, outcome: true } },
  file: { select: { id: true, fileName: true, fileType: true, fileSize: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  confirmedBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: { sortOrder: "asc" },
    include: {
      party: { select: { id: true, name: true, role: true, email: true } },
      task: { select: { id: true, status: true, assignedUserId: true, dueAt: true } },
      files: { orderBy: { createdAt: "asc" }, select: { file: { select: { id: true, fileName: true, permitDocType: true } } } },
      previousItem: { select: { id: true, reviewerItemNumber: true, sortOrder: true } },
    },
  },
} satisfies Prisma.PermitCorrectionNoticeInclude;

/** A permit's notices with their items, newest first; `restart` lists readings a restart cut off. */
export async function loadCorrections(permitId: string) {
  const notices = await prisma.permitCorrectionNotice.findMany({ where: { permitId }, orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }], include: NOTICE_INCLUDE });
  const callIds = notices.map((n) => n.aiCallId).filter((v): v is string => !!v);
  const calls = callIds.length ? await prisma.aiCall.findMany({ where: { id: { in: callIds } }, select: { id: true, model: true, costUsd: true } }) : [];
  const callOf = new Map(calls.map((c) => [c.id, c]));
  const now = new Date();
  const restart = notices.filter((n) => isStaleExtraction(n, now)).map((n) => n.id);
  // a reading cut off by restarts three times is given up on, so the page stops waiting
  for (const n of notices) {
    if (n.status === "EXTRACTING" && n.attempts >= MAX_EXTRACT_ATTEMPTS && n.extractStartedAt && now.getTime() - n.extractStartedAt.getTime() > STALE_EXTRACT_MS) {
      await prisma.permitCorrectionNotice.update({ where: { id: n.id }, data: { status: "FAILED", error: "The reading did not finish. Read it again, or type the items by hand." } });
      n.status = "FAILED";
    }
  }
  return { notices: notices.map((n) => ({ ...n, aiCall: n.aiCallId ? (callOf.get(n.aiCallId) ?? null) : null })), restart };
}

// ─── Items ──────────────────────────────────────────────────────────────────

async function checkItemLinks(permitId: string, noticeId: string, input: { partyId?: string | null; previousItemId?: string | null }) {
  if (input.partyId) {
    const p = await prisma.permitParty.findUnique({ where: { id: input.partyId }, select: { permitId: true } });
    if (p?.permitId !== permitId) throw new PermitIntelError(400, "That party is not on this permit");
  }
  if (input.previousItemId) {
    const p = await prisma.permitCorrectionItem.findUnique({ where: { id: input.previousItemId }, select: { permitId: true, noticeId: true } });
    if (p?.permitId !== permitId || p.noticeId === noticeId) throw new PermitIntelError(400, "The earlier comment must be one from an earlier notice on this permit");
  }
}

async function raiseItemTask(itemId: string): Promise<void> {
  const item = await prisma.permitCorrectionItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { party: { select: { name: true } }, notice: { select: { responseDueAt: true, receivedAt: true } }, permit: { select: PERMIT_OWNER_SELECT } },
  });
  if (item.taskId || isClosedStatus(item.status as CorrectionStatus) || item.status === "PROPOSED") return;
  const plan = itemTask({ ...item, partyName: item.party?.name ?? null }, permitLabelOf(item.permit));
  const due = item.dueAt ?? item.notice.responseDueAt;
  const taskId = await raiseOnce(item.permit, {
    sourceKey: correctionItemKey(item.id),
    title: plan.title,
    description: plan.description,
    priority: plan.priority,
    dueDay: due ? dayKey(due) : resubmitDueDay(item.notice.receivedAt, null),
    audience: "coordinator",
  });
  if (taskId) await prisma.permitCorrectionItem.update({ where: { id: item.id }, data: { taskId } });
}

export async function addItem(noticeId: string, input: ItemCreateInput, actor: Actor) {
  const n = await prisma.permitCorrectionNotice.findUnique({ where: { id: noticeId }, select: { id: true, permitId: true, status: true, _count: { select: { items: true } } } });
  if (!n) throw new PermitIntelError(404, "Notice not found");
  if (n.status === "EXTRACTING") throw new PermitIntelError(409, "The notice is being read now; add items once it is done");
  await checkItemLinks(n.permitId, n.id, input);
  const max = await prisma.permitCorrectionItem.aggregate({ where: { noticeId }, _max: { sortOrder: true } });
  const item = await prisma.permitCorrectionItem.create({
    data: { ...input, noticeId, permitId: n.permitId, sortOrder: (max._max.sortOrder ?? -1) + 1, status: n.status === "CONFIRMED" ? statusOnConfirm(input.responsibleParty) : "PROPOSED" },
  });
  await audit(actor, n.permitId, "correction_item_add", undefined, { itemId: item.id, noticeId, number: item.reviewerItemNumber, status: item.status });
  if (n.status === "CONFIRMED") await raiseItemTask(item.id);
  return item;
}

const CONTENT_FIELDS = ["reviewerItemNumber", "reviewerDiscipline", "text", "sourcePage", "category", "affects", "affectsRef", "responsibleParty", "partyId"] as const;

export async function updateItem(itemId: string, patch: ItemPatchInput, actor: Actor) {
  const before = await prisma.permitCorrectionItem.findUnique({ where: { id: itemId }, include: { notice: { select: { id: true, status: true } }, task: { select: { id: true, status: true } } } });
  if (!before) throw new PermitIntelError(404, "Item not found");
  await checkItemLinks(before.permitId, before.notice.id, patch);
  const { status, ...fields } = patch;
  const data: Prisma.PermitCorrectionItemUncheckedUpdateInput = { ...fields };
  // the model's confidence describes the model's reading, not a person's
  if (CONTENT_FIELDS.some((k) => patch[k] !== undefined && patch[k] !== before[k])) data.confidence = null;
  if (status && status !== before.status) {
    if (before.notice.status !== "CONFIRMED") throw new PermitIntelError(409, "Confirm the notice before working its items");
    if (!canMoveTo(before.status as CorrectionStatus, status)) throw new PermitIntelError(400, "An item cannot go back to proposed");
    data.status = status;
    data.resolvedAt = isClosedStatus(status) ? new Date() : null;
  }
  const item = await prisma.permitCorrectionItem.update({ where: { id: itemId }, data });
  const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  await audit(actor, before.permitId, "correction_item_update", { itemId, status: before.status }, { itemId, status: item.status, fields: changed });

  if (status && status !== before.status) {
    const key = correctionItemKey(itemId);
    if (isClosedStatus(status)) {
      await closeAutoTask(key, { actorUserId: actor.id, outcome: status === "WAIVED" ? "CANCELLED" : "COMPLETED", because: status === "WAIVED" ? "The correction was waived" : "The correction was resolved" });
    } else if (before.task && !(OPEN_TASK_STATUSES as readonly string[]).includes(before.task.status)) {
      // reopened: its task comes back with it
      await updateTask({ id: before.task.id, input: { status: "PENDING" }, actorUserId: actor.id });
    } else if (!before.taskId && before.status !== "PROPOSED") {
      await raiseItemTask(itemId);
    }
  }
  return item;
}

/** Only a proposed item is deleted; a confirmed one is a task and a record — it is waived. */
export async function deleteItem(itemId: string, actor: Actor) {
  const item = await prisma.permitCorrectionItem.findUnique({ where: { id: itemId }, select: { id: true, permitId: true, status: true, text: true } });
  if (!item) throw new PermitIntelError(404, "Item not found");
  if (item.status !== "PROPOSED") throw new PermitIntelError(409, "A confirmed item cannot be deleted. Mark it waived instead.");
  await prisma.permitCorrectionItem.delete({ where: { id: itemId } });
  await audit(actor, item.permitId, "correction_item_delete", { itemId, text: item.text.slice(0, 200) });
}

export async function linkItemFile(itemId: string, fileId: string, actor: Actor) {
  const item = await prisma.permitCorrectionItem.findUnique({ where: { id: itemId }, select: { id: true, permitId: true } });
  if (!item) throw new PermitIntelError(404, "Item not found");
  const file = await prisma.file.findUnique({ where: { id: fileId }, select: { id: true, permitId: true, fileName: true } });
  if (!file || file.permitId !== item.permitId) throw new PermitIntelError(400, "The revised file must be one of this permit's documents");
  await prisma.permitCorrectionItemFile.upsert({ where: { itemId_fileId: { itemId, fileId } }, create: { itemId, fileId }, update: {} });
  await audit(actor, item.permitId, "correction_item_file_link", undefined, { itemId, fileId, fileName: file.fileName });
}

export async function unlinkItemFile(itemId: string, fileId: string, actor: Actor) {
  const item = await prisma.permitCorrectionItem.findUnique({ where: { id: itemId }, select: { id: true, permitId: true } });
  if (!item) throw new PermitIntelError(404, "Item not found");
  await prisma.permitCorrectionItemFile.deleteMany({ where: { itemId, fileId } });
  await audit(actor, item.permitId, "correction_item_file_unlink", { itemId, fileId });
}

// ─── Confirming ─────────────────────────────────────────────────────────────

/**
 * A person confirms the notice: its items become the permit's open
 * corrections, each a task; the review cycle (and with it the permit) moves
 * to corrections; the earlier review's comments get their outcome; the
 * corrected package gets a due date.
 */
export async function confirmNotice(noticeId: string, actor: Actor) {
  const n = await prisma.permitCorrectionNotice.findUnique({
    where: { id: noticeId },
    include: { cycle: { select: { id: true, number: true, outcome: true } }, items: { select: { id: true, responsibleParty: true, previousItemId: true, status: true } }, permit: { select: { ...PERMIT_OWNER_SELECT, currentCycle: true } } },
  });
  if (!n) throw new PermitIntelError(404, "Notice not found");
  if (n.status === "CONFIRMED") throw new PermitIntelError(409, "This notice is already confirmed");
  if (n.status === "EXTRACTING") throw new PermitIntelError(409, "The notice is still being read");
  if (!n.items.length) throw new PermitIntelError(400, "Add at least one correction before confirming, or remove the notice");

  const claimed = await prisma.permitCorrectionNotice.updateMany({ where: { id: noticeId, status: { in: ["REVIEW", "FAILED"] } }, data: { status: "CONFIRMED", confirmedByUserId: actor.id, confirmedAt: new Date(), error: null } });
  if (!claimed.count) throw new PermitIntelError(409, "Someone else has just confirmed or changed this notice");
  for (const i of n.items) {
    if (i.status === "PROPOSED") await prisma.permitCorrectionItem.update({ where: { id: i.id }, data: { status: statusOnConfirm(i.responsibleParty) } });
  }
  await audit(actor, n.permitId, "correction_notice_confirm", undefined, { noticeId, cycle: n.cycle.number, items: n.items.length });

  // the department's answer on the cycle; the permit's status follows through updatePermit
  if (n.cycle.outcome === "PENDING" && n.cycle.number === n.permit.currentCycle) {
    await recordCycleOutcome(n.cycle.id, { outcome: "CORRECTIONS", outcomeAt: n.receivedAt, reviewerName: n.reviewerName }, actor);
  }

  const repeated = new Set(n.items.map((i) => i.previousItemId).filter((v): v is string => !!v));
  const earlier = await prisma.permitCorrectionItem.findMany({
    where: { permitId: n.permitId, notice: { cycle: { number: { lt: n.cycle.number } } } },
    select: { id: true, status: true, reviewOutcome: true },
  });
  await settleEarlier(earlierOutcomes(earlier.map((e) => ({ ...e, status: e.status as CorrectionStatus })), repeated, false), actor.id, n.cycle.number);
  // the comments the department accepted are something its reviewers ask for: a lesson
  await proposeLessonsFor(n.permitId);

  for (const i of n.items) {
    try {
      await raiseItemTask(i.id);
    } catch (err) {
      logger.exception(err, { where: "corrections.confirm.itemTask", itemId: i.id });
    }
  }
  try {
    const dueDay = n.responseDueAt ? dayKey(n.responseDueAt) : resubmitDueDay(n.receivedAt, null);
    await raiseOnce(n.permit, {
      sourceKey: resubmitKey(n.permitId, n.cycle.number),
      title: `Resubmit the ${permitLabelOf(n.permit)} with the corrections`,
      description: `Cycle ${n.cycle.number} came back with ${n.items.length} correction${n.items.length === 1 ? "" : "s"}. When every item is answered, freeze the corrected package on the permit's Submissions tab — that closes this task.`,
      priority: "HIGH",
      dueDay,
      audience: "coordinator",
    });
  } catch (err) {
    logger.exception(err, { where: "corrections.confirm.resubmitTask", noticeId });
  }
  await closeAutoTask(correctionsReceivedKey(n.permitId, n.cycle.number), { actorUserId: actor.id, outcome: "COMPLETED", because: "The corrections were reviewed and confirmed" });
  return prisma.permitCorrectionNotice.findUniqueOrThrow({ where: { id: noticeId }, include: NOTICE_INCLUDE });
}

/**
 * The department has reviewed the resubmission: each earlier comment gets
 * its outcome, and one still open is settled with it — accepted, or answered
 * by the new comment that repeats it — so its task does not linger.
 */
async function settleEarlier(outcomes: { id: string; outcome: "ACCEPTED" | "RECOMMENTED" }[], actorUserId: string | null, cycleNumber: number) {
  for (const o of outcomes) {
    const item = await prisma.permitCorrectionItem.update({ where: { id: o.id }, data: { reviewOutcome: o.outcome }, select: { id: true, status: true } });
    if (isClosedStatus(item.status as CorrectionStatus)) continue;
    await prisma.permitCorrectionItem.update({ where: { id: item.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await closeAutoTask(correctionItemKey(item.id), {
      actorUserId,
      outcome: "COMPLETED",
      because: o.outcome === "ACCEPTED" ? `The department accepted the response on review cycle ${cycleNumber}` : `The department commented on it again on review cycle ${cycleNumber}; the new comment carries it`,
    });
  }
}

// ─── Hooks from the permit record ───────────────────────────────────────────

/** The corrected package went back (a frozen resubmission): the resubmission task is done. Never throws. */
export async function onResubmitted(permitId: string, newCycle: number, actorUserId: string): Promise<void> {
  if (newCycle < 2) return;
  await closeAutoTask(resubmitKey(permitId, newCycle - 1), { actorUserId, outcome: "COMPLETED", because: `The corrected package was submitted (review cycle ${newCycle})` });
}

/** The department approved a later cycle: every earlier comment still without an outcome was accepted. Never throws. */
export async function onCycleApproved(permitId: string, cycleNumber: number): Promise<void> {
  try {
    const earlier = await prisma.permitCorrectionItem.findMany({ where: { permitId, reviewOutcome: null, status: { not: "PROPOSED" }, notice: { cycle: { number: { lt: cycleNumber } } } }, select: { id: true, status: true, reviewOutcome: true } });
    await settleEarlier(earlierOutcomes(earlier.map((e) => ({ ...e, status: e.status as CorrectionStatus })), new Set(), true), null, cycleNumber);
    await proposeLessonsFor(permitId);
  } catch (err) {
    logger.exception(err, { where: "corrections.onCycleApproved", permitId });
  }
}

