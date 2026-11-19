import { createHash } from "node:crypto";
import { Prisma, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { AI_NOT_CONFIGURED, AiError, defaultModel, isAiConfigured } from "@/lib/ai/client";
import { contentMatchesType } from "@/lib/files/sniff";
import { uploadProblem } from "@/lib/files/limits";
import { readFile, saveFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { leadAccessWhere } from "@/lib/access/records";
import { PartnerError } from "@/lib/partners/errors";
import { readyProblems, setBidStatus } from "@/lib/partners/bids";
import { canTransition } from "@/lib/partners/bid-state";
import { addOpportunity, createProject, findProjectMatches, setOpportunityScopes, type ProjectInput } from "./project";
import { confirmProblems, draftFromExtraction, emptyDraft, isStaleExtraction, MAX_EXTRACT_ATTEMPTS, STALE_EXTRACT_MS, type Extraction, type ReviewDraft, LINE_KINDS } from "./proposal-plan";
import { xlsxToText } from "./xlsx-text";
import { docxToText } from "./docx-text";
import * as extract from "./prompts/proposal-extract";

/**
 * Upload Estimate: a KNU proposal (PDF, Word .docx, picture, xlsx or CSV) with any
 * supporting material, read by the AI into a review, checked and corrected
 * by a person, confirmed into a VERIFIED version on a project with its GC
 * opportunities. The file is kept whatever happens to the reading; the same
 * file uploaded again opens the version it already made; a confirmed
 * version is never edited — a revision is a new upload.
 *
 * Nothing here records that a proposal was sent: that is a submission
 * (recordSubmissions), and only a VERIFIED version can be one.
 */

type Viewer = { id: string; role: RoleName };
type Upload = { name: string; type: string; bytes: Buffer };

const MAX_MODEL_BYTES = 22 * 1024 * 1024; // base64 grows a file by a third inside the 32 MB request
const IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEXTY = new Set(["text/csv", "text/plain"]);
const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Which uploads the reader takes; Word and old .xls are refused with a way out. */
export function readableProblem(f: { name: string; type: string; size: number }): string | null {
  const p = uploadProblem(f);
  if (p) return p;
  if (f.type === "application/vnd.ms-excel") return `${f.name}: save the spreadsheet as .xlsx (or print it to PDF) — the old .xls format cannot be read`;
  if (f.type === "application/msword") return `${f.name}: save it as .docx (or print it to PDF) — the old .doc format cannot be read`;
  if (!(f.type === "application/pdf" || IMAGE.has(f.type) || f.type === SHEET || f.type === WORD || TEXTY.has(f.type))) return `${f.name}: upload a PDF, a Word .docx, a picture, an .xlsx or a CSV`;
  return null;
}

async function storeFile(u: Upload, projectId: string | null, actorUserId: string, sha256: string) {
  if (!contentMatchesType(u.type, u.bytes.subarray(0, 16))) throw new PartnerError(400, `${u.name}: the file's content does not match its type`);
  const stored = await saveFile(u.bytes, u.name);
  return prisma.file.create({ data: { fileName: u.name, fileType: u.type, storageKey: stored.storageKey, fileSize: stored.bytes, category: "ESTIMATE", uploadedByUserId: actorUserId, bidProjectId: projectId, sha256 }, select: { id: true } });
}

export async function uploadProposal(input: { file: Upload; supporting: Upload[]; supportingText: string | null; projectId: string | null }, actorUserId: string): Promise<{ versionId: string; duplicate: boolean }> {
  for (const f of [input.file, ...input.supporting]) {
    const p = readableProblem({ name: f.name, type: f.type, size: f.bytes.length });
    if (p) throw new PartnerError(400, p);
  }
  if (input.projectId && !(await prisma.bidProject.findUnique({ where: { id: input.projectId }, select: { id: true } }))) throw new PartnerError(404, "Project not found");
  const sha256 = createHash("sha256").update(input.file.bytes).digest("hex");
  // The same file again opens what it already made — on this project, or anywhere when no project was picked.
  const twin = await prisma.bidProposalVersion.findFirst({ where: { sha256, ...(input.projectId ? { OR: [{ bidProjectId: input.projectId }, { bidProjectId: null }] } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (twin) return { versionId: twin.id, duplicate: true };
  const main = await storeFile(input.file, input.projectId, actorUserId, sha256);
  const supportingIds: string[] = [];
  for (const s of input.supporting) supportingIds.push((await storeFile(s, input.projectId, actorUserId, createHash("sha256").update(s.bytes).digest("hex"))).id);
  const ai = isAiConfigured();
  const version = await prisma.$transaction(async (tx) => {
    const proposal = await tx.bidProposal.create({ data: { bidProjectId: input.projectId, title: input.file.name.replace(/\.[a-z0-9]+$/i, "") }, select: { id: true } });
    return tx.bidProposalVersion.create({
      data: {
        bidProposalId: proposal.id,
        bidProjectId: input.projectId,
        version: 1,
        fileId: main.id,
        sha256,
        supportingFileIds: supportingIds,
        supportingText: input.supportingText?.trim().slice(0, 100_000) || null,
        status: ai ? "EXTRACTING" : "FAILED",
        extractError: ai ? null : `${AI_NOT_CONFIGURED} — type the values from the document.`,
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });
  });
  await recordAudit({ actorUserId, entityType: "BidProposalVersion", entityId: version.id, action: "bid_proposal_upload", after: { fileId: main.id, sha256, projectId: input.projectId, supporting: supportingIds.length, hasText: Boolean(input.supportingText) } });
  return { versionId: version.id, duplicate: false };
}

async function docFor(fileId: string): Promise<extract.ProposalDoc | string> {
  const f = await prisma.file.findUnique({ where: { id: fileId }, select: { fileName: true, fileType: true, fileSize: true, storageKey: true } });
  if (!f) return "A document is missing";
  if (f.fileSize > MAX_MODEL_BYTES) return `${f.fileName} is too large to read (over 22 MB); upload only the pages with the price`;
  let bytes: Buffer;
  try {
    bytes = await readFile(f.storageKey);
  } catch {
    return `${f.fileName} is missing from the store; upload it again`;
  }
  if (f.fileType === "application/pdf") return { kind: "pdf", name: f.fileName, base64: bytes.toString("base64") };
  if (IMAGE.has(f.fileType)) return { kind: "image", name: f.fileName, base64: bytes.toString("base64"), mediaType: f.fileType as "image/png" };
  if (f.fileType === WORD) {
    try {
      const x = docxToText(bytes);
      return { kind: "text", name: `${f.fileName}${x.truncated ? " (first part only — the document is very long)" : ""}`, text: x.text };
    } catch {
      return `${f.fileName} could not be opened as a Word document; save it again as .docx or print it to PDF`;
    }
  }
  if (f.fileType === SHEET) {
    const x = await xlsxToText(bytes);
    return { kind: "text", name: `${f.fileName}${x.truncated ? " (first part only — the workbook is very large)" : ""}`, text: x.text };
  }
  return { kind: "text", name: f.fileName, text: bytes.toString("utf8").slice(0, 150_000) };
}

/** The reading, in the background. Claimed so two page loads never read twice; never throws. */
export async function runProposalExtraction(versionId: string, userId: string | null): Promise<void> {
  const now = new Date();
  const claim = await prisma.bidProposalVersion.updateMany({
    where: { id: versionId, status: "EXTRACTING", extractAttempts: { lt: MAX_EXTRACT_ATTEMPTS }, OR: [{ extractStartedAt: null }, { extractStartedAt: { lt: new Date(now.getTime() - STALE_EXTRACT_MS) } }] },
    data: { extractStartedAt: now, extractAttempts: { increment: 1 } },
  });
  if (!claim.count) return;
  const fail = (error: string) => prisma.bidProposalVersion.update({ where: { id: versionId }, data: { status: "FAILED", extractError: error.slice(0, 500) } });
  try {
    const v = await prisma.bidProposalVersion.findUniqueOrThrow({ where: { id: versionId }, select: { id: true, fileId: true, sha256: true, supportingFileIds: true, supportingText: true, proposal: { select: { bidProject: { select: { name: true, address1: true, city: true } } } } } });
    if (!v.fileId) return void (await fail("The estimate file is missing; type the values from the document."));
    const main = await docFor(v.fileId);
    if (typeof main === "string") return void (await fail(main));
    const supporting: extract.ProposalDoc[] = [];
    for (const id of v.supportingFileIds) {
      const d = await docFor(id);
      if (typeof d !== "string") supporting.push(d);
    }
    if (v.supportingText) supporting.push({ kind: "text", name: "pasted text (an invitation email or notes)", text: v.supportingText });
    const trades = await prisma.serviceCategory.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const p = v.proposal.bidProject;
    const ctx: extract.ExtractContext = { trades: trades.map((t) => t.name), projectHint: p ? { name: p.name, address: [p.address1, p.city].filter(Boolean).join(", ") || null } : null };
    const result = await runAiCall({
      subjectType: "bid_proposal_version",
      subjectId: v.id,
      purpose: extract.PURPOSE,
      promptVersion: extract.PROMPT_VERSION,
      schema: extract.schema,
      inputs: { file: v.sha256, supporting: v.supportingFileIds, text: v.supportingText ? createHash("sha256").update(v.supportingText).digest("hex") : null, ctx },
      system: extract.SYSTEM,
      content: extract.content(ctx, main, supporting),
      model: defaultModel(),
      effort: "medium",
      maxTokens: 16_000,
      userId,
    });
    await prisma.bidProposalVersion.update({ where: { id: v.id }, data: { status: "REVIEW", extractError: null, aiCallId: result.callId, extracted: { ai: result.output } as Prisma.InputJsonValue } });
  } catch (err) {
    if (err instanceof AiError) return void (await fail(`${err.message} — type the values from the document, or read it again.`));
    logger.exception(err, { where: "bids.runProposalExtraction", versionId });
    await fail("The estimate could not be read. Read it again, or type the values from the document.").catch(() => undefined);
  }
}

/** Who may open a version: its project's rule, or (unfiled) whoever uploaded it and the non-own-only roles. */
export async function versionVisible(viewer: Viewer, versionId: string): Promise<boolean> {
  const scoped = leadAccessWhere(viewer);
  const own = Object.keys(scoped).length > 0;
  const hit = await prisma.bidProposalVersion.findFirst({
    where: { id: versionId, ...(own ? { OR: [{ createdByUserId: viewer.id }, { proposal: { bidProject: { OR: [{ ownerUserId: viewer.id }, { opportunities: { some: { lead: scoped } } }] } } }] } : {}) },
    select: { id: true },
  });
  return Boolean(hit);
}

const VERSION_SELECT = {
  id: true, version: true, status: true, extractError: true, extractAttempts: true, extractStartedAt: true, extracted: true, sha256: true,
  proposalDate: true, validUntil: true, currency: true, total: true, bundleAdjustment: true, inclusions: true, exclusions: true, alternates: true, clarifications: true,
  organizationId: true, verifiedAt: true, createdAt: true, supportingFileIds: true, supportingText: true, bidProjectId: true,
  file: { select: { id: true, fileName: true, fileType: true, fileSize: true } },
  proposal: { select: { id: true, number: true, title: true, bidProject: { select: { id: true, number: true, name: true } } } },
  lines: { orderBy: { sortOrder: "asc" as const }, select: { id: true, scopeId: true, kind: true, description: true, amount: true, scope: { select: { label: true, serviceCategoryId: true } } } },
} satisfies Prisma.BidProposalVersionSelect;

/** The review: the draft (a person's saved edits, else the AI's reading, else blank), with project and GC suggestions. */
export async function getProposalVersion(id: string) {
  const v = await prisma.bidProposalVersion.findUnique({ where: { id }, select: VERSION_SELECT });
  if (!v) throw new PartnerError(404, "Proposal not found");
  const restart = isStaleExtraction(v, new Date());
  const trades = await prisma.serviceCategory.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const saved = (v.extracted as { ai?: Extraction; review?: ReviewDraft } | null) ?? null;
  const draft: ReviewDraft = saved?.review ?? (saved?.ai ? draftFromExtraction(saved.ai, trades) : emptyDraft());
  const f = draft.fields;
  const projectMatches = v.bidProjectId ? [] : await findProjectMatches({ platformRef: f.planhubProjectId.value || null, address1: f.address1.value || null, zipCode: f.zipCode.value || null, name: f.projectName.value || null });
  const gcMatches = await gcSuggestions(f.gcCompany.value, draft.gcContacts.map((c) => c.email).filter((e): e is string => Boolean(e)));
  const supporting = v.supportingFileIds.length ? await prisma.file.findMany({ where: { id: { in: v.supportingFileIds } }, select: { id: true, fileName: true } }) : [];
  const n = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
  return {
    ...v,
    extracted: undefined,
    total: n(v.total),
    bundleAdjustment: n(v.bundleAdjustment),
    lines: v.lines.map((l) => ({ ...l, amount: Number(l.amount) })),
    draft,
    hasAiReading: Boolean(saved?.ai),
    restart,
    projectMatches,
    gcMatches,
    supporting,
    trades: trades.map((t) => ({ value: t.id, label: t.name })),
  };
}
export type ProposalVersionView = Awaited<ReturnType<typeof getProposalVersion>>;

/** GC accounts the document may mean: a contact's email, the email domain, then the name. Suggestions only. */
async function gcSuggestions(name: string, emails: string[]) {
  const out = new Map<string, { id: string; name: string; how: string; contactId: string | null }>();
  for (const e of emails) {
    const c = await prisma.contact.findFirst({ where: { email: { equals: e, mode: "insensitive" } }, select: { id: true, organization: { select: { id: true, name: true } } } });
    if (c && !out.has(c.organization.id)) out.set(c.organization.id, { id: c.organization.id, name: c.organization.name, how: "contact email", contactId: c.id });
  }
  const domains = emails.map((e) => e.split("@")[1]?.toLowerCase()).filter((d): d is string => Boolean(d) && !/gmail|yahoo|outlook|hotmail|icloud|aol|planhub/.test(d!));
  for (const d of domains) {
    const orgs = await prisma.organization.findMany({ where: { OR: [{ email: { endsWith: `@${d}`, mode: "insensitive" } }, { website: { contains: d, mode: "insensitive" } }] }, select: { id: true, name: true }, take: 3 });
    for (const o of orgs) if (!out.has(o.id)) out.set(o.id, { ...o, how: "email domain", contactId: null });
  }
  const words = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["inc", "llc", "corp", "the", "construction", "builders", "group", "company"].includes(w));
  if (words.length) {
    const orgs = await prisma.organization.findMany({ where: { AND: words.slice(0, 3).map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) }, select: { id: true, name: true }, take: 5 });
    for (const o of orgs) if (!out.has(o.id)) out.set(o.id, { ...o, how: "name", contactId: null });
  }
  return [...out.values()];
}

/** A person's corrections, saved as they go (the AI's own reading is kept beside them). */
export async function saveReview(id: string, draft: ReviewDraft, actorUserId: string) {
  const v = await prisma.bidProposalVersion.findUnique({ where: { id }, select: { status: true, extracted: true } });
  if (!v) throw new PartnerError(404, "Proposal not found");
  if (v.status !== "REVIEW" && v.status !== "FAILED") throw new PartnerError(409, v.status === "EXTRACTING" ? "The estimate is still being read" : "A confirmed proposal is never edited; upload the revision as a new version");
  const prev = (v.extracted as Record<string, unknown> | null) ?? {};
  await prisma.bidProposalVersion.update({ where: { id }, data: { extracted: { ...prev, review: draft } as Prisma.InputJsonValue } });
  await recordAudit({ actorUserId, entityType: "BidProposalVersion", entityId: id, action: "bid_proposal_review", after: { fields: Object.fromEntries(Object.entries(draft.fields).map(([k, f]) => [k, f.value])), lines: draft.lines.length } });
}

/** Read it again: the person's edits are dropped (they came from the old reading). */
export async function rereadVersion(id: string, actorUserId: string) {
  if (!isAiConfigured()) throw new PartnerError(503, AI_NOT_CONFIGURED);
  const v = await prisma.bidProposalVersion.findUnique({ where: { id }, select: { status: true } });
  if (!v) throw new PartnerError(404, "Proposal not found");
  if (v.status !== "REVIEW" && v.status !== "FAILED") throw new PartnerError(409, "Only an unconfirmed proposal is read again");
  await prisma.bidProposalVersion.update({ where: { id }, data: { status: "EXTRACTING", extractAttempts: 0, extractStartedAt: null, extractError: null, extracted: Prisma.DbNull } });
  await recordAudit({ actorUserId, entityType: "BidProposalVersion", entityId: id, action: "bid_proposal_reread" });
}

export type ConfirmProposalInput = {
  project: { id: string } | { create: ProjectInput & { name: string }; force?: boolean };
  proposalNumber: string | null;
  proposalDate: string | null;
  validUntil: string | null;
  total: number;
  bundleAdjustment: number;
  lines: { serviceCategoryId: string | null; kind: (typeof LINE_KINDS)[number]; description: string | null; amount: number }[];
  inclusions: string | null;
  exclusions: string | null;
  alternates: string | null;
  clarifications: string | null;
  /** A price for one GC only. */
  organizationId: string | null;
  gcs: { organizationId: string; contactId: string | null; bidDueAt: string | null; estimatorUserId?: string | null }[];
};

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00.000Z`) : null);

/**
 * Confirm: file the version on its project (made now if needed), make the
 * scopes its lines price, add or update the GCs it goes to, and mark it
 * VERIFIED. A GC's opportunity moves to Estimating, and to Ready to submit
 * when someone there has an email — never to Submitted.
 */
export async function confirmVersion(id: string, input: ConfirmProposalInput, viewer: Viewer) {
  const v = await prisma.bidProposalVersion.findUnique({ where: { id }, select: { id: true, status: true, sha256: true, fileId: true, supportingFileIds: true, bidProposalId: true, proposal: { select: { bidProjectId: true, number: true } } } });
  if (!v) throw new PartnerError(404, "Proposal not found");
  if (v.status !== "REVIEW" && v.status !== "FAILED") throw new PartnerError(409, v.status === "EXTRACTING" ? "The estimate is still being read" : "This proposal is already confirmed");
  const creating = "create" in input.project;
  const problems = confirmProblems({ total: input.total, bundleAdjustment: input.bundleAdjustment, lines: input.lines, projectName: creating ? (input.project as { create: { name: string } }).create.name : null, creatingProject: creating, gcs: input.gcs.map((g) => ({ organizationId: g.organizationId, bidDueAt: g.bidDueAt })) });
  if (problems.length) throw new PartnerError(400, problems.join("; "), { problems });

  // The project: the one chosen (which this person must be able to open), or a new one.
  let projectId: string;
  if ("id" in input.project) {
    projectId = input.project.id;
    const scoped = leadAccessWhere(viewer);
    const ok = await prisma.bidProject.findFirst({ where: { id: projectId, ...(Object.keys(scoped).length ? { OR: [{ ownerUserId: viewer.id }, { opportunities: { some: { lead: scoped } } }] } : {}) }, select: { id: true, stage: true } });
    if (!ok) throw new PartnerError(404, "Project not found");
    if (v.proposal.bidProjectId && v.proposal.bidProjectId !== projectId) throw new PartnerError(409, "This proposal was uploaded on another project");
  } else {
    projectId = (await createProject({ ...input.project.create, scopes: [] }, viewer.id, Boolean(input.project.force))).id;
  }
  if (v.sha256) {
    const twin = await prisma.bidProposalVersion.findFirst({ where: { bidProjectId: projectId, sha256: v.sha256, NOT: { id } }, select: { id: true } });
    if (twin) throw new PartnerError(409, "This exact file is already filed on the project", { versionId: twin.id });
  }

  const tradeIds = [...new Set(input.lines.map((l) => l.serviceCategoryId).filter((x): x is string => Boolean(x)))];
  const result = await prisma.$transaction(async (tx) => {
    // Scopes for every trade the lines price.
    const existing = await tx.bidProjectScope.findMany({ where: { bidProjectId: projectId }, select: { id: true, serviceCategoryId: true, sortOrder: true } });
    const cats = await tx.serviceCategory.findMany({ where: { id: { in: tradeIds } }, select: { id: true, name: true } });
    let order = existing.length;
    const scopeOf = new Map(existing.map((s) => [s.serviceCategoryId, s.id]));
    for (const c of cats) {
      if (scopeOf.has(c.id)) continue;
      const s = await tx.bidProjectScope.create({ data: { bidProjectId: projectId, serviceCategoryId: c.id, label: c.name, sortOrder: order++ }, select: { id: true } });
      scopeOf.set(c.id, s.id);
    }
    // Which proposal it belongs to: the project's proposal with the same number makes this its next version.
    let proposalId = v.bidProposalId;
    let version = 1;
    const number = input.proposalNumber?.trim() || null;
    const same = number ? await tx.bidProposal.findFirst({ where: { bidProjectId: projectId, number, NOT: { id: v.bidProposalId } }, select: { id: true, versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } } } }) : null;
    if (same) {
      proposalId = same.id;
      version = (same.versions[0]?.version ?? 0) + 1;
    }
    await tx.bidProposalVersion.update({
      where: { id },
      data: {
        bidProposalId: proposalId,
        bidProjectId: projectId,
        version,
        status: "VERIFIED",
        proposalDate: day(input.proposalDate),
        validUntil: day(input.validUntil),
        total: input.total,
        bundleAdjustment: input.bundleAdjustment || null,
        inclusions: input.inclusions?.trim() || null,
        exclusions: input.exclusions?.trim() || null,
        alternates: input.alternates?.trim() || null,
        clarifications: input.clarifications?.trim() || null,
        organizationId: input.organizationId,
        verifiedByUserId: viewer.id,
        verifiedAt: new Date(),
      },
    });
    if (same) await tx.bidProposal.delete({ where: { id: v.bidProposalId } });
    else await tx.bidProposal.update({ where: { id: proposalId }, data: { bidProjectId: projectId, number } });
    await tx.bidProposalLine.deleteMany({ where: { versionId: id } });
    await tx.bidProposalLine.createMany({ data: input.lines.map((l, i) => ({ versionId: id, scopeId: l.serviceCategoryId ? scopeOf.get(l.serviceCategoryId)! : null, kind: l.kind, description: l.description?.trim() || null, amount: l.amount, sortOrder: i })) });
    // Earlier checked versions of the same proposal, for the same GC (or every GC), are superseded — kept, never deleted.
    const superseded = await tx.bidProposalVersion.updateMany({ where: { bidProposalId: proposalId, status: "VERIFIED", organizationId: input.organizationId, NOT: { id } }, data: { status: "SUPERSEDED" } });
    // The file (and anything read with it) now lives on the project.
    await tx.file.updateMany({ where: { id: { in: [v.fileId, ...v.supportingFileIds].filter((x): x is string => Boolean(x)) }, bidProjectId: null }, data: { bidProjectId: projectId } });
    return { proposalId, version, superseded: superseded.count, scopeIds: tradeIds.map((t) => scopeOf.get(t)!) };
  });

  // The GCs it goes to.
  const opportunities: { bidId: string; number: string; status: string; ready: string[] }[] = [];
  for (const g of input.gcs) {
    const wanted = result.scopeIds;
    let bid = await prisma.bidInvitation.findFirst({ where: { bidProjectId: projectId, organizationId: g.organizationId }, select: { id: true, number: true, status: true, scopes: { select: { scopeId: true } } } });
    if (!bid) {
      const made = await addOpportunity(projectId, { organizationId: g.organizationId, contactId: g.contactId, scopeIds: wanted, bidDueAt: g.bidDueAt, estimatorUserId: g.estimatorUserId ?? viewer.id, status: "INVITED", signalSource: "proposal_upload" }, viewer.id);
      bid = { id: made.id, number: made.number, status: made.status, scopes: made.scopes.map((s) => ({ scopeId: s.scope.id })) };
    } else {
      const have = bid.scopes.map((s) => s.scopeId);
      const add = wanted.filter((s) => !have.includes(s));
      if (add.length && bid.status !== "CLOSED") await setOpportunityScopes(bid.id, [...have, ...add], viewer.id);
      if (g.bidDueAt || g.contactId) await prisma.bidInvitation.update({ where: { id: bid.id }, data: { ...(g.bidDueAt ? { bidDueAt: /^\d{4}-\d{2}-\d{2}$/.test(g.bidDueAt) ? new Date(`${g.bidDueAt}T12:00:00.000Z`) : new Date(g.bidDueAt) } : {}), ...(g.contactId ? { contactId: g.contactId } : {}) } });
    }
    let status = bid.status;
    for (const step of ["ESTIMATING", "READY_TO_SUBMIT"] as const) {
      const cur = (await prisma.bidInvitation.findUniqueOrThrow({ where: { id: bid.id }, select: { status: true } })).status;
      status = cur;
      if (cur === step || cur === "CLOSED" || cur === "SUBMITTED" || cur === "SHORTLISTED") break;
      if (cur === "TRACKING") await setBidStatus(bid.id, "INVITED", undefined, viewer.id);
      const now = (await prisma.bidInvitation.findUniqueOrThrow({ where: { id: bid.id }, select: { status: true } })).status;
      if (!canTransition(now, step)) break;
      if (step === "READY_TO_SUBMIT" && (await readyProblems(bid.id)).length) break;
      await setBidStatus(bid.id, step, undefined, viewer.id);
      status = step;
    }
    opportunities.push({ bidId: bid.id, number: bid.number, status, ready: await readyProblems(bid.id) });
  }
  await recordAudit({ actorUserId: viewer.id, entityType: "BidProposalVersion", entityId: id, action: "bid_proposal_verified", after: { projectId, proposalId: result.proposalId, version: result.version, total: input.total, lines: input.lines.length, superseded: result.superseded, organizationId: input.organizationId, gcs: opportunities.map((o) => o.number) } });
  return { projectId, versionId: id, version: result.version, opportunities };
}
