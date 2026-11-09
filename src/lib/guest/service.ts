import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { env } from "@/lib/env";
import { contentMatchesType } from "@/lib/files/sniff";
import { deleteFile, saveFile } from "@/lib/files/storage";
import { createPaymentRequest } from "@/lib/labor/payment-requests";
import { logger } from "@/lib/logger";
import { jobMoneyView } from "@/lib/money/access";
import { notify } from "@/lib/notifications/notify";
import { createTask } from "@/lib/tasks/create";
import { APP_TIME_ZONE } from "@/lib/time/zone";
import { userForJobRole } from "@/lib/workflows/roles";
import { answerSchemas, linkMessage, linkState, LINK_LIFETIME_MS, MAX_GUEST_PHOTO_BYTES, photosNeeded, type GuestLanguage, type GuestPurpose, type LinkState } from "./purposes";
import { hashGuestToken, looksLikeGuestToken, newGuestToken } from "./token";

/**
 * Guest links: a secure, single-purpose link the office sends to a crew, and
 * the crew's answer. Nothing a crew sends takes effect until a person accepts
 * it (decideSubmission): photos wait outside the job's files, and a payment
 * request is made only on acceptance.
 */
export class GuestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Viewer = { id: string; role: RoleName };
type StoredPhoto = { key: string; name: string; type: string; bytes: number };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** Who may send links and decide submissions on a job: whoever sees its full money and may write (office roles, the job's PM). */
export function canRunGuestLinks(viewer: Viewer, job: { projectManagerId: string | null }): boolean {
  return viewer.role !== "READ_ONLY" && jobMoneyView(viewer, job) === "full";
}

function street(lead: { propertyAddress1: string; city: string } | null): string {
  return lead ? [lead.propertyAddress1, lead.city].filter(Boolean).join(", ") : "the job";
}

function dayText(d: Date, lang: GuestLanguage): string {
  return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: APP_TIME_ZONE });
}

const baseUrl = () => (env.APP_BASE_URL ?? env.NEXTAUTH_URL ?? "https://crm.careyos.com").replace(/\/$/, "");

export async function createGuestLink(viewer: Viewer, input: { purpose: GuestPurpose; laborContractId?: string; crewAssignmentId?: string }) {
  let jobId: string;
  let crew: { id: string; name: string; foremanName: string | null; phone: string | null; language: string } | null = null;
  let label: string | null = null;
  let when: Date | null = null;
  if (input.purpose === "INSTALL_CONFIRM") {
    if (!input.crewAssignmentId) throw new GuestError("Pick the crew assignment to confirm", 400);
    const a = await prisma.crewAssignment.findUnique({ where: { id: input.crewAssignmentId }, include: { crew: true } });
    if (!a) throw new GuestError("Crew assignment not found", 404);
    if (!a.installDate) throw new GuestError("Set the install date first", 400);
    jobId = a.jobId;
    crew = a.crew;
    when = a.installDate;
  } else {
    if (!input.laborContractId) throw new GuestError("Pick the crew's labor contract", 400);
    const c = await prisma.laborContract.findUnique({ where: { id: input.laborContractId }, include: { crew: true } });
    if (!c) throw new GuestError("Labor contract not found", 404);
    jobId = c.jobId;
    crew = c.crew;
    label = c.label;
  }
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, projectManagerId: true, lead: { select: { propertyAddress1: true, city: true } } } });
  if (!job) throw new GuestError("Job not found", 404);
  if (!canRunGuestLinks(viewer, job)) throw new GuestError("Crew links are sent by the office and the job's project manager", 403);

  const language: GuestLanguage = crew?.language === "es" ? "es" : "en";
  const subject = input.crewAssignmentId ? { crewAssignmentId: input.crewAssignmentId } : { laborContractId: input.laborContractId };
  const now = new Date();
  // A new link for the same crew and purpose replaces the open one.
  await prisma.guestLink.updateMany({ where: { purpose: input.purpose, ...subject, revokedAt: null, submittedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
  const token = newGuestToken();
  const link = await prisma.guestLink.create({
    data: {
      tokenHash: hashGuestToken(token),
      purpose: input.purpose,
      jobId,
      ...subject,
      crewId: crew?.id ?? null,
      recipientName: crew?.foremanName ?? crew?.name ?? label,
      language,
      expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS[input.purpose]),
      createdByUserId: viewer.id,
    },
  });
  const url = `${baseUrl()}/g/${token}`;
  await recordAudit({ actorUserId: viewer.id, entityType: "GuestLink", entityId: link.id, action: "guest_link_create", after: { purpose: input.purpose, jobId, ...subject } });
  return {
    id: link.id,
    url,
    expiresAt: link.expiresAt.toISOString(),
    language,
    phone: crew?.phone ?? null,
    recipientName: link.recipientName,
    message: linkMessage(input.purpose, language, { name: crew?.foremanName ?? null, street: street(job.lead), url, when: when ? dayText(when, language) : null }),
  };
}

async function findByToken(token: string) {
  if (!looksLikeGuestToken(token)) return null;
  return prisma.guestLink.findUnique({
    where: { tokenHash: hashGuestToken(token) },
    include: {
      job: { select: { id: true, projectManagerId: true, lead: { select: { propertyAddress1: true, city: true } } } },
      laborContract: { select: { description: true, label: true, crew: { select: { name: true } } } },
      crewAssignment: { select: { installDate: true, crew: { select: { name: true } } } },
    },
  });
}

export type GuestView =
  | { state: "notFound" }
  | {
      state: LinkState;
      purpose: GuestPurpose;
      language: GuestLanguage;
      street: string;
      crewName: string | null;
      recipientName: string | null;
      scope: string | null;
      when: string | null;
      photos: { min: number; max: number };
    };

/** What the guest page shows: only what the action needs (no customer, prices or documents). */
export async function guestView(token: string): Promise<GuestView> {
  const l = await findByToken(token);
  if (!l) return { state: "notFound" };
  const language: GuestLanguage = l.language === "es" ? "es" : "en";
  const purpose = l.purpose as GuestPurpose;
  return {
    state: linkState(l, new Date()),
    purpose,
    language,
    street: street(l.job.lead),
    crewName: l.laborContract?.crew?.name ?? l.crewAssignment?.crew?.name ?? l.laborContract?.label ?? null,
    recipientName: l.recipientName,
    scope: l.laborContract?.description ? l.laborContract.description.slice(0, 240) : null,
    when: l.crewAssignment?.installDate ? dayText(l.crewAssignment.installDate, language) : null,
    photos: photosNeeded(purpose),
  };
}

/** The page reports that it was opened (by script, so link previews that never run it do not count). */
export async function markOpened(token: string): Promise<void> {
  const l = await findByToken(token);
  if (!l || l.firstOpenedAt) return;
  await prisma.guestLink.update({ where: { id: l.id }, data: { firstOpenedAt: new Date() } });
}

export async function submitGuest(token: string, rawAnswer: unknown, files: File[]): Promise<{ id: string }> {
  const l = await findByToken(token);
  if (!l) throw new GuestError("notFound", 404);
  const state = linkState(l, new Date());
  if (state !== "open") throw new GuestError(state, 410);
  const purpose = l.purpose as GuestPurpose;
  const answer = answerSchemas[purpose].safeParse(rawAnswer);
  if (!answer.success) throw new GuestError("Check the form and try again", 400);
  const need = photosNeeded(purpose);
  if (files.length < need.min || files.length > need.max) throw new GuestError(need.min ? "Add at least one photo" : "Too many photos", 400);

  // Photos are checked and stored now, but become job files only when accepted.
  const stored: StoredPhoto[] = [];
  try {
    for (const f of files) {
      if (!IMAGE_TYPES.has(f.type) || f.size === 0 || f.size > MAX_GUEST_PHOTO_BYTES) throw new GuestError("Photos only, up to 15 MB each", 400);
      const buf = Buffer.from(await f.arrayBuffer());
      if (!contentMatchesType(f.type, buf.subarray(0, 8192))) throw new GuestError("That file is not a photo", 400);
      const s = await saveFile(buf, f.name || "photo.jpg");
      stored.push({ key: s.storageKey, name: f.name || "photo.jpg", type: f.type, bytes: s.bytes });
    }
  } catch (err) {
    for (const s of stored) await deleteFile(s.key).catch(() => undefined);
    throw err;
  }

  // Claim the link in the same step: two submissions at once, only one wins.
  const claimed = await prisma.guestLink.updateMany({ where: { id: l.id, submittedAt: null, revokedAt: null }, data: { submittedAt: new Date(), firstOpenedAt: l.firstOpenedAt ?? new Date() } });
  if (claimed.count === 0) {
    for (const s of stored) await deleteFile(s.key).catch(() => undefined);
    throw new GuestError("used", 410);
  }
  const sub = await prisma.guestSubmission.create({ data: { linkId: l.id, jobId: l.jobId, purpose, payload: answer.data, photos: stored } });
  await notifyReviewers(sub.id, l.jobId, purpose, l.createdByUserId, l.recipientName, street(l.job.lead), l.job.projectManagerId);
  return { id: sub.id };
}

const PURPOSE_WORDS: Record<GuestPurpose, string> = { CREW_PHOTOS: "sent photos", CREW_PAYMENT: "requested a payment", INSTALL_CONFIRM: "answered the install day" };

async function notifyReviewers(submissionId: string, jobId: string, purpose: GuestPurpose, creatorId: string, who: string | null, where: string, pmId: string | null) {
  try {
    const ids = new Set<string>([creatorId]);
    if (pmId) ids.add(pmId);
    if (purpose === "CREW_PAYMENT") {
      const acct = await userForJobRole(jobId, "ACCOUNTING");
      if (acct) ids.add(acct);
    }
    const lead = await prisma.job.findUnique({ where: { id: jobId }, select: { leadId: true } });
    await notify({
      kind: "crew.submission",
      candidates: [...ids].map((userId) => ({ userId, reason: "owner" as const })),
      actorUserId: null,
      subject: { type: "job", id: submissionId, jobId, leadId: lead?.leadId ?? null },
      title: `${who ?? "A crew"} ${PURPOSE_WORDS[purpose]} · ${where}`,
      body: "Review it under Crew submissions.",
      href: `/crew-submissions?id=${submissionId}`,
    });
  } catch (err) {
    logger.warn("crew submission notification failed", { submissionId, message: err instanceof Error ? err.message : String(err) });
  }
}

/** Submissions a person may review: every job for the office roles, their own jobs for a PM. */
export async function listSubmissions(viewer: Viewer, status: "PENDING" | "ALL" = "PENDING", jobId?: string) {
  const office = ["ADMIN", "MANAGER", "OFFICE_STAFF"].includes(viewer.role);
  const rows = await prisma.guestSubmission.findMany({
    where: {
      ...(status === "PENDING" ? { status: "PENDING" } : {}),
      ...(jobId ? { jobId } : {}),
      ...(office ? {} : { job: { projectManagerId: viewer.id } }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      job: { select: { id: true, jobNumber: true, lead: { select: { propertyAddress1: true, city: true } } } },
      link: { select: { purpose: true, recipientName: true, laborContractId: true, crewAssignmentId: true, language: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    purpose: r.purpose as GuestPurpose,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    jobId: r.jobId,
    jobNumber: r.job.jobNumber,
    street: street(r.job.lead),
    from: r.link.recipientName,
    language: r.link.language,
    answer: r.payload as Record<string, unknown>,
    photoCount: (r.photos as StoredPhoto[]).length,
    reviewNote: r.reviewNote,
    reviewedBy: r.reviewedBy ? `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}`.trim() : null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    result: r.result,
  }));
}

async function loadForReview(viewer: Viewer, id: string) {
  const sub = await prisma.guestSubmission.findUnique({
    where: { id },
    include: { link: true, job: { select: { id: true, leadId: true, projectManagerId: true, lead: { select: { propertyAddress1: true, city: true } } } } },
  });
  if (!sub) throw new GuestError("Submission not found", 404);
  if (!canRunGuestLinks(viewer, sub.job)) throw new GuestError("Submission not found", 404);
  return sub;
}

/** A pending photo's bytes, for the reviewer. */
export async function submissionPhoto(viewer: Viewer, id: string, n: number): Promise<StoredPhoto> {
  const sub = await loadForReview(viewer, id);
  const p = (sub.photos as StoredPhoto[])[n];
  if (!p) throw new GuestError("Photo not found", 404);
  return p;
}

/**
 * Accept or reject. Accepting makes it count: photos become job files, a
 * payment request is created for the crew's contract (a task for the job's
 * accounting person, as from the web), a day answer is recorded on the crew
 * assignment (a task for the PM when the crew can't make it). Rejecting
 * deletes the held photos.
 */
export async function decideSubmission(viewer: Viewer, id: string, decision: "accept" | "reject", note?: string | null) {
  const sub = await loadForReview(viewer, id);
  if (sub.status !== "PENDING") throw new GuestError("Already decided", 409);
  // Claim it first: two people deciding at once, only one wins.
  const claim = await prisma.guestSubmission.updateMany({ where: { id, status: "PENDING" }, data: { status: decision === "accept" ? "ACCEPTED" : "REJECTED", reviewedByUserId: viewer.id, reviewedAt: new Date(), reviewNote: note?.trim() || null } });
  if (claim.count === 0) throw new GuestError("Already decided", 409);
  const photos = sub.photos as StoredPhoto[];
  const purpose = sub.purpose as GuestPurpose;

  if (decision === "reject") {
    for (const p of photos) await deleteFile(p.key).catch(() => undefined);
    await recordAudit({ actorUserId: viewer.id, entityType: "GuestSubmission", entityId: id, action: "guest_submission_reject", after: { note } });
    return { status: "REJECTED" as const };
  }

  const answer = sub.payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  try {
    let paymentRequestId: string | null = null;
    if (purpose === "CREW_PAYMENT") {
      if (!sub.link.laborContractId) throw new GuestError("The crew's labor contract no longer exists", 409);
      const who = sub.link.recipientName ?? "the crew";
      const req = await createPaymentRequest({
        contractId: sub.link.laborContractId,
        amount: Number(answer.amount),
        note: [`Requested by ${who} through a crew link.`, typeof answer.note === "string" ? answer.note : ""].filter(Boolean).join(" "),
        actorUserId: viewer.id,
      });
      paymentRequestId = req.id;
      result.paymentRequestId = req.id;
    }
    if (photos.length) {
      const files = [];
      for (const p of photos) {
        files.push(
          await prisma.file.create({
            data: {
              leadId: sub.job.leadId,
              jobId: sub.jobId,
              fileName: p.name,
              fileType: p.type,
              fileSize: p.bytes,
              storageKey: p.key,
              category: "PHOTOS",
              uploadedByUserId: viewer.id,
              ...(paymentRequestId ? { laborPaymentRequestId: paymentRequestId } : {}),
            },
            select: { id: true },
          }),
        );
      }
      result.fileIds = files.map((f) => f.id);
    }
    if (purpose === "INSTALL_CONFIRM" && sub.link.crewAssignmentId) {
      const value = answer.answer === "yes" ? "CONFIRMED" : answer.answer === "no" ? "CANT_MAKE_IT" : "CHANGE_REQUESTED";
      await prisma.crewAssignment.update({ where: { id: sub.link.crewAssignmentId }, data: { confirmation: value, confirmationAt: new Date() } });
      result.confirmation = value;
      if (value !== "CONFIRMED") {
        const task = await createTask(
          {
            jobId: sub.jobId,
            title: `${sub.link.recipientName ?? "The crew"} ${value === "CANT_MAKE_IT" ? "can't make" : "asks to move"} the install day · ${street(sub.job.lead)}`,
            description: typeof answer.note === "string" && answer.note ? `Crew's note: ${answer.note}` : null,
            priority: "HIGH",
            assignedUserId: sub.job.projectManagerId ?? viewer.id,
            createdByUserId: viewer.id,
            dueAt: new Date(),
            source: "guest_link",
          },
          { actorUserId: viewer.id },
        );
        result.taskId = task.id;
      }
    }
  } catch (err) {
    // Put it back so it can be decided again once the problem is fixed.
    await prisma.guestSubmission.update({ where: { id }, data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null } });
    throw err;
  }
  await prisma.guestSubmission.update({ where: { id }, data: { result: result as object } });
  await recordAudit({ actorUserId: viewer.id, entityType: "GuestSubmission", entityId: id, action: "guest_submission_accept", after: result });
  return { status: "ACCEPTED" as const, result };
}

/** A job's links, for the office: who, what, and how far each got. */
export async function linksForJob(viewer: Viewer, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { projectManagerId: true } });
  if (!job || !canRunGuestLinks(viewer, job)) throw new GuestError("Job not found", 404);
  const now = new Date();
  const rows = await prisma.guestLink.findMany({ where: { jobId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((l) => ({
    id: l.id,
    purpose: l.purpose,
    laborContractId: l.laborContractId,
    crewAssignmentId: l.crewAssignmentId,
    recipientName: l.recipientName,
    state: linkState(l, now),
    createdAt: l.createdAt.toISOString(),
    firstOpenedAt: l.firstOpenedAt?.toISOString() ?? null,
    submittedAt: l.submittedAt?.toISOString() ?? null,
    expiresAt: l.expiresAt.toISOString(),
  }));
}

export async function revokeLink(viewer: Viewer, id: string) {
  const l = await prisma.guestLink.findUnique({ where: { id }, include: { job: { select: { projectManagerId: true } } } });
  if (!l || !canRunGuestLinks(viewer, l.job)) throw new GuestError("Link not found", 404);
  await prisma.guestLink.update({ where: { id }, data: { revokedAt: l.revokedAt ?? new Date() } });
  await recordAudit({ actorUserId: viewer.id, entityType: "GuestLink", entityId: id, action: "guest_link_revoke" });
}
