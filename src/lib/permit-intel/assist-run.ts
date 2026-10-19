import { createHash } from "node:crypto";
import path from "node:path";
import type { Prisma, RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { runAiCall } from "@/lib/ai/calls";
import { isAiConfigured, AI_NOT_CONFIGURED, AiError } from "@/lib/ai/client";
import { readPdfText } from "@/lib/files/pdf-text";
import { deleteFile, readFile, saveFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { approvalNumbers, askedFor, coverage, duplicateOf, MAX_FETCHES_PER_RUN, MAX_UPLOADS_PER_RUN, pickedLinks, type Findings, type PlanItem } from "./assist-plan";
import { isPermitDocType, permitDocLabel } from "./doc-types";
import { htmlPage, mayFollow, pdfLinks, siteHostsOf, APPROVAL_HOSTS, hostWithin, type FollowContext, type FoundLink } from "./links";
import * as read from "./prompts/assist-read";
import { createApproval } from "./approvals";
import { loadRequirementsFor, PermitIntelError } from "./service";
import { fetchedKind, robotsAllows, robotsFor, safeFetch, urlProblem } from "./web-fetch";

/**
 * The permit document assistant. A person hands it documents (and, if they
 * like, the building department's website); it reads each, opens the links
 * worth opening, and proposes a type for each document against the
 * jurisdiction's checklist. Nothing becomes a document of the permit, gets a
 * type, or goes into a submission until a person accepts it.
 *
 * Work runs after the answer (`after()`), one item at a time, each claimed
 * first; an item cut off by a restart is taken up again once stale, and the
 * run is picked up again whenever the permit's assistant is opened.
 */
type Actor = { id: string; role: RoleName };

const STALE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** The API takes a request of 32 MB, a PDF of 100 pages; base64 grows a file by a third. */
const MAX_PDF_BYTES = 22 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const READABLE_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const audit = (actor: { id: string } | null, permitId: string, action: string, after?: unknown) =>
  recordAudit({ actorUserId: actor?.id ?? null, entityType: "JobPermit", entityId: permitId, action, after });

// ─── Starting ───────────────────────────────────────────────────────────────

export type StartInput = { fileIds: string[]; includeUntyped: boolean; searchSite: boolean };

export async function startAssistRun(permitId: string, input: StartInput, actor: Actor) {
  if (!isAiConfigured()) throw new PermitIntelError(503, `${AI_NOT_CONFIGURED}. The assistant needs it.`);
  const permit = await prisma.jobPermit.findUnique({ where: { id: permitId }, select: { id: true, jurisdiction: { select: { name: true, websiteUrl: true } } } });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const running = await prisma.permitAssistRun.findFirst({ where: { permitId, status: "RUNNING" }, select: { id: true } });
  if (running) throw new PermitIntelError(409, "The assistant is still working on this permit. Wait for it to finish, then start another pass.");
  if (input.searchSite && !permit.jurisdiction?.websiteUrl) throw new PermitIntelError(400, "Add the building department's website under Admin → Permits → Jurisdictions first");

  const picked = await prisma.file.findMany({
    where: { permitId, OR: [{ id: { in: input.fileIds } }, ...(input.includeUntyped ? [{ permitDocType: null }] : [])] },
    select: { id: true, fileName: true, fileType: true, fileSize: true },
    orderBy: { createdAt: "asc" },
  });
  if (input.fileIds.some((id) => !picked.some((f) => f.id === id))) throw new PermitIntelError(400, "One of the documents is not on this permit");
  if (picked.length > MAX_UPLOADS_PER_RUN) throw new PermitIntelError(400, `Hand the assistant at most ${MAX_UPLOADS_PER_RUN} documents at a time`);
  if (!picked.length && !input.searchSite) throw new PermitIntelError(400, "Add documents, or ask the assistant to look on the building department's website");

  const run = await prisma.permitAssistRun.create({
    data: {
      permitId,
      searchSite: input.searchSite,
      startedByUserId: actor.id,
      items: {
        create: [
          ...picked.map((f) => ({ permitId, source: "UPLOAD" as const, fileId: f.id, fileName: f.fileName, fileType: f.fileType, sizeBytes: f.fileSize })),
          ...(input.searchSite && permit.jurisdiction?.websiteUrl
            ? [{ permitId, source: "SITE" as const, url: permit.jurisdiction.websiteUrl, reason: `${permit.jurisdiction.name}'s website`, linkText: permit.jurisdiction.name }]
            : []),
        ],
      },
    },
  });
  await audit(actor, permitId, "assist_start", { runId: run.id, documents: picked.length, searchSite: input.searchSite });
  return run;
}

// ─── Working ────────────────────────────────────────────────────────────────

type ItemRow = Prisma.PermitAssistItemGetPayload<{ include: { parent: { select: { source: true } }; file: { select: { storageKey: true; fileType: true; fileName: true } } } }>;

async function claimNext(runId: string): Promise<ItemRow | null> {
  const staleBefore = new Date(Date.now() - STALE_MS);
  for (let tries = 0; tries < 5; tries++) {
    const next = await prisma.permitAssistItem.findFirst({
      where: { runId, attempts: { lt: MAX_ATTEMPTS }, OR: [{ status: "QUEUED" }, { status: "READING", startedAt: { lt: staleBefore } }] },
      orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
      select: { id: true, status: true, startedAt: true },
    });
    if (!next) return null;
    const claim = await prisma.permitAssistItem.updateMany({
      where: { id: next.id, status: next.status, startedAt: next.startedAt },
      data: { status: "READING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count) return prisma.permitAssistItem.findUnique({ where: { id: next.id }, include: { parent: { select: { source: true } }, file: { select: { storageKey: true, fileType: true, fileName: true } } } });
  }
  return null;
}

/** Work the run until nothing is left; the run is done once no item is waiting or being read. Never throws. */
export async function stepAssistRun(runId: string, userId: string | null): Promise<void> {
  const robots = new Map<string, string>();
  try {
    for (let n = 0; n < 200; n++) {
      const item = await claimNext(runId);
      if (!item) break;
      await processItem(item, userId, robots);
    }
    const busy = await prisma.permitAssistItem.count({ where: { runId, OR: [{ status: "QUEUED", attempts: { lt: MAX_ATTEMPTS } }, { status: "READING" }] } });
    if (!busy) {
      // an item that ran out of attempts while queued or reading has failed
      await prisma.permitAssistItem.updateMany({ where: { runId, status: { in: ["QUEUED", "READING"] } }, data: { status: "FAILED", error: "Could not be read after three tries" } });
      await prisma.permitAssistRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { status: "DONE", finishedAt: new Date() } });
    }
  } catch (err) {
    logger.exception(err, { where: "assist.stepAssistRun", runId });
  }
}

const fail = (id: string, error: string) => prisma.permitAssistItem.update({ where: { id }, data: { status: "FAILED", error: error.slice(0, 500) } });

function followContext(item: ItemRow, siteHosts: string[]): FollowContext {
  return { source: item.source, depth: item.depth, siteHosts };
}

/** The name a fetched document is filed under: the last part of its address, else its title. */
export function fetchedName(url: string, kind: "pdf" | "image", contentType: string | null): string {
  let base = "";
  try {
    base = decodeURIComponent(path.posix.basename(new URL(url).pathname));
  } catch {
    /* an odd address gets a plain name */
  }
  base = base.replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  const ext = kind === "pdf" ? ".pdf" : `.${(contentType ?? "image/png").split("/")[1].replace("jpeg", "jpg")}`;
  if (!base || base === "/") base = kind === "pdf" ? "document" : "picture";
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}

async function processItem(item: ItemRow, userId: string | null, robots: Map<string, string>): Promise<void> {
  try {
    const permit = await prisma.jobPermit.findUniqueOrThrow({
      where: { id: item.permitId },
      select: {
        id: true,
        municipality: true,
        permitType: true,
        permitTypeKey: true,
        jurisdictionId: true,
        scopeDescription: true,
        jurisdiction: { select: { name: true, websiteUrl: true, allowedHosts: true } },
        files: { where: { permitDocType: { not: null } }, select: { permitDocType: true } },
      },
    });
    const siteHosts = siteHostsOf(permit.jurisdiction);
    const ctxFollow = followContext(item, siteHosts);

    // 1. the bytes
    let bytes: Buffer;
    let kind: "pdf" | "html" | "image" | null;
    let fileType = item.fileType;
    let finalUrl: string | null = null;
    if (item.source === "UPLOAD") {
      if (!item.file) return void (await fail(item.id, "The document is no longer on the permit"));
      try {
        bytes = await readFile(item.file.storageKey);
      } catch {
        return void (await fail(item.id, "The document is missing from the store. Upload it again."));
      }
      kind = item.file.fileType === "application/pdf" ? "pdf" : READABLE_IMAGE.has(item.file.fileType) ? "image" : null;
      if (!kind) {
        await prisma.permitAssistItem.update({ where: { id: item.id }, data: { status: "PROPOSED", sha256: createHash("sha256").update(bytes).digest("hex"), summary: "Only PDFs and pictures are read. Choose its type yourself." } });
        return;
      }
    } else {
      // a fetch: within the run's budget, allowed by robots.txt and the host policy
      const budget = await prisma.permitAssistRun.updateMany({ where: { id: item.runId, fetchCount: { lt: MAX_FETCHES_PER_RUN } }, data: { fetchCount: { increment: 1 } } });
      if (!budget.count) return void (await fail(item.id, `Not opened: this pass has already opened ${MAX_FETCHES_PER_RUN} pages`));
      const url = item.url!;
      // a link a person's document names may lead anywhere public; from there on, only the department's and approval sites
      const freeHop = item.source === "LINK" && item.depth === 1 && item.parent?.source === "UPLOAD";
      const allowUrl = (u: string) => {
        if (freeHop) return null;
        const host = new URL(u).hostname;
        return [...siteHosts, ...APPROVAL_HOSTS].some((s) => hostWithin(host, s)) ? null : `${host} is not the building department's site or an approval site`;
      };
      const log = (outcome: "OK" | "REFUSED" | "ERROR", d: { finalUrl?: string | null; httpStatus?: number | null; contentType?: string | null; bytes?: number | null; note?: string | null }) =>
        prisma.permitAssistFetch.create({ data: { runId: item.runId, itemId: item.id, url, outcome, finalUrl: d.finalUrl ?? null, httpStatus: d.httpStatus ?? null, contentType: d.contentType ?? null, bytes: d.bytes ?? null, note: d.note?.slice(0, 500) ?? null } });
      try {
        const u = new URL(url);
        if (!robotsAllows(await robotsFor(u.origin, robots), `${u.pathname}${u.search}`)) {
          await log("REFUSED", { note: "the site's robots.txt asks not to open it" });
          return void (await fail(item.id, "Not opened: the site's robots.txt asks automated readers not to open it"));
        }
      } catch {
        /* a bad address is refused by the fetcher below */
      }
      const res = await safeFetch(url, { allowUrl });
      if (!res.ok) {
        await log(res.refused ? "REFUSED" : "ERROR", { finalUrl: res.finalUrl, httpStatus: res.status, note: res.reason });
        return void (await fail(item.id, `${res.refused ? "Not opened" : "Could not open it"}: ${res.reason}`));
      }
      kind = fetchedKind(res.contentType, res.body);
      await log(kind ? "OK" : "REFUSED", { finalUrl: res.finalUrl, httpStatus: res.status, contentType: res.contentType, bytes: res.body.length, note: kind ? null : "not a PDF, a picture or a web page" });
      if (!kind) return void (await fail(item.id, `Not a document or a web page (${res.contentType ?? "unknown type"})`));
      bytes = res.body;
      finalUrl = res.finalUrl;
      if (kind !== "html") {
        fileType = kind === "pdf" ? "application/pdf" : res.contentType!;
        const name = fetchedName(res.finalUrl, kind, res.contentType);
        const stored = await saveFile(bytes, name);
        await prisma.permitAssistItem.update({ where: { id: item.id }, data: { storageKey: stored.storageKey, fileName: name, fileType, sizeBytes: stored.bytes, finalUrl } });
      }
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // 2. its text and links
    let input: read.ReadInput;
    let found: FoundLink[] = [];
    let pageTitle: string | null = null;
    if (kind === "pdf") {
      const text = await readPdfText(bytes);
      found = text ? pdfLinks(text.links, text.pages) : [];
      if (bytes.length <= MAX_PDF_BYTES && (text?.pageCount ?? 0) <= MAX_PDF_PAGES) input = { kind: "pdf", base64: bytes.toString("base64"), fileName: item.fileName ?? "document.pdf" };
      else if (text && text.pages.join("").trim().length > 40) input = { kind: "text", name: `${item.fileName ?? "document"} (first pages, as text)`, text: text.pages.join("\n\n") };
      else return void (await fail(item.id, "Too large to read (over 22 MB or 100 pages) and has no text to read instead"));
    } else if (kind === "image") {
      if (bytes.length > MAX_IMAGE_BYTES) return void (await fail(item.id, "The picture is over 5 MB; upload a smaller one or a PDF"));
      input = { kind: "image", base64: bytes.toString("base64"), mediaType: (fileType ?? "image/png") as "image/png" };
    } else {
      const page = htmlPage(bytes.toString("utf8"), finalUrl ?? item.url!);
      pageTitle = page.title;
      found = page.links;
      input = { kind: "text", name: `web page ${finalUrl ?? item.url}${page.title ? ` — "${page.title}"` : ""}`, text: page.text };
    }
    // the model only ever sees links the fetcher would open: a private or local address is never offered
    const followable = found.filter((l) => !urlProblem(l.url) && mayFollow(ctxFollow, l.url).ok);

    // 3. the AI reads it
    const checklist = (await loadRequirementsFor(permit)).map((r) => r.title);
    const ctx: read.ReadContext = {
      jurisdiction: permit.jurisdiction?.name ?? permit.municipality,
      permitType: permit.permitType,
      scope: permit.scopeDescription,
      onFile: [...new Set(permit.files.map((f) => permitDocLabel(f.permitDocType)))],
      checklist,
      source: item.source === "UPLOAD" ? `a document a person uploaded ("${item.fileName}")` : item.source === "SITE" ? `${kind === "html" ? "a page" : "a document"} from the building department's website (${finalUrl})` : `${kind === "html" ? "a page" : "a document"} opened from a link (${finalUrl})`,
    };
    const result = await runAiCall({
      subjectType: "permit_assist_run",
      subjectId: item.runId,
      purpose: read.PURPOSE,
      promptVersion: read.PROMPT_VERSION,
      schema: read.schema,
      inputs: { sha256, ctx, links: followable.map((l) => [l.id, l.url, l.text]) },
      system: read.SYSTEM,
      content: read.content(ctx, input, followable),
      model: read.MODEL,
      effort: "medium",
      maxTokens: 8_000,
      userId,
    });
    const out = result.output;
    const findings: Findings = { asks: out.asks, approvalNumbers: out.approvalNumbers, deadlines: out.deadlines, relevant: out.relevant };
    await prisma.permitAssistItem.update({
      where: { id: item.id },
      data: {
        status: kind === "html" ? "PAGE" : "PROPOSED",
        sha256,
        suggestedType: kind === "html" ? null : out.docType,
        title: (out.title || pageTitle || item.fileName || "").slice(0, 200) || null,
        summary: out.summary.slice(0, 4000),
        findings: findings as unknown as Prisma.InputJsonValue,
        links: followable as unknown as Prisma.InputJsonValue,
        aiCallId: result.callId,
        error: null,
      },
    });

    // 4. the links worth opening become items of their own
    const picks = pickedLinks(out.openLinks, followable);
    if (picks.length) {
      const [run, known, queued] = await Promise.all([
        prisma.permitAssistRun.findUniqueOrThrow({ where: { id: item.runId }, select: { fetchCount: true } }),
        prisma.permitAssistItem.findMany({ where: { runId: item.runId, url: { not: null } }, select: { url: true, finalUrl: true } }),
        prisma.permitAssistItem.count({ where: { runId: item.runId, status: "QUEUED", url: { not: null } } }),
      ]);
      const seen = new Set(known.flatMap((k) => [k.url, k.finalUrl]).filter(Boolean) as string[]);
      let room = MAX_FETCHES_PER_RUN - run.fetchCount - queued;
      for (const p of picks) {
        if (room <= 0 || seen.has(p.url)) continue;
        seen.add(p.url);
        room--;
        await prisma.permitAssistItem.create({
          data: { runId: item.runId, permitId: item.permitId, source: item.source === "UPLOAD" ? "LINK" : item.source, parentItemId: item.id, depth: item.depth + 1, url: p.url, linkText: p.text?.slice(0, 200) ?? null, reason: p.reason },
        });
      }
    }
  } catch (err) {
    if (err instanceof AiError) return void (await fail(item.id, err.message));
    logger.exception(err, { where: "assist.processItem", itemId: item.id });
    // left READING: taken up again once stale, up to three tries
  }
}

// ─── Reading ────────────────────────────────────────────────────────────────

const ITEM_SELECT = {
  id: true,
  source: true,
  parentItemId: true,
  depth: true,
  reason: true,
  linkText: true,
  url: true,
  finalUrl: true,
  fileId: true,
  fileName: true,
  fileType: true,
  sizeBytes: true,
  sha256: true,
  status: true,
  startedAt: true,
  error: true,
  suggestedType: true,
  decidedType: true,
  title: true,
  summary: true,
  findings: true,
  approvalId: true,
  storageKey: true,
  decidedAt: true,
  decidedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.PermitAssistItemSelect;

/** The permit's latest assistant pass, what it found and how it lines up with the checklist; `restart` when work was cut off. */
export async function loadAssist(permitId: string) {
  const permit = await prisma.jobPermit.findUnique({
    where: { id: permitId },
    select: { id: true, jurisdictionId: true, permitTypeKey: true, jurisdiction: { select: { name: true, websiteUrl: true } }, files: { select: { id: true, fileName: true, permitDocType: true } } },
  });
  if (!permit) throw new PermitIntelError(404, "Permit not found");
  const run = await prisma.permitAssistRun.findFirst({
    where: { permitId },
    orderBy: { createdAt: "desc" },
    include: { startedBy: { select: { firstName: true, lastName: true } }, items: { orderBy: [{ depth: "asc" }, { createdAt: "asc" }], select: ITEM_SELECT }, fetches: { orderBy: { createdAt: "asc" } } },
  });
  const untyped = permit.files.filter((f) => !f.permitDocType).length;
  const base = { website: permit.jurisdiction?.websiteUrl ?? null, jurisdiction: permit.jurisdiction?.name ?? null, untypedOnPermit: untyped, aiReady: isAiConfigured() };
  if (!run) return { ...base, run: null, restart: false };

  const reqs = await loadRequirementsFor(permit);
  const planItems: PlanItem[] = run.items.map((i) => ({ id: i.id, status: i.status, title: i.title, fileName: i.fileName, suggestedType: i.suggestedType, decidedType: i.decidedType, sha256: i.sha256, findings: (i.findings as Findings | null) ?? null, source: i.source }));
  const files = permit.files.map((f) => ({ id: f.id, fileName: f.fileName, permitDocType: f.permitDocType }));
  const planReqs = reqs.map((r) => ({ id: r.id, title: r.title, documentType: r.documentType, required: r.required }));
  const dup = duplicateOf(planItems);
  const spend = await prisma.aiCall.aggregate({ where: { subjectType: "permit_assist_run", subjectId: run.id }, _sum: { costUsd: true } });
  // open, and nobody is reading an item right now: the work was cut off (or only the closing is left)
  const staleBefore = Date.now() - STALE_MS;
  const restart = run.status === "RUNNING" && !run.items.some((i) => i.status === "READING" && (i.startedAt?.getTime() ?? 0) > staleBefore);
  return {
    ...base,
    restart,
    run: {
      id: run.id,
      status: run.status,
      searchSite: run.searchSite,
      fetchCount: run.fetchCount,
      maxFetches: MAX_FETCHES_PER_RUN,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      startedBy: run.startedBy,
      spentUsd: Number(spend._sum.costUsd ?? 0),
      items: run.items.map(({ storageKey, ...i }) => ({ ...i, hasBytes: !!storageKey || !!i.fileId, duplicateOf: dup.get(i.id) ?? null })),
      fetches: run.fetches,
      coverage: coverage(planReqs, files, planItems),
      asks: askedFor(planItems, files, planReqs),
      approvalNumbers: approvalNumbers(planItems),
    },
  };
}

// ─── Deciding ───────────────────────────────────────────────────────────────

export type ItemDecision = { action: "accept"; docType: string } | { action: "reject" } | { action: "approval" };

/** Accept (the document joins the permit with the type chosen), reject, or send a product approval to the approvals reader. */
export async function decideAssistItem(itemId: string, d: ItemDecision, actor: Actor) {
  const item = await prisma.permitAssistItem.findUnique({
    where: { id: itemId },
    include: { file: { select: { id: true, storageKey: true } }, run: { select: { permit: { select: { id: true, jobId: true, job: { select: { leadId: true } } } } } } },
  });
  if (!item) throw new PermitIntelError(404, "Item not found");
  const permit = item.run.permit;

  if (d.action === "approval") {
    const key = item.file?.storageKey ?? item.storageKey;
    if (!key || item.fileType !== "application/pdf") throw new PermitIntelError(400, "Only a PDF can be read as a product approval");
    if (item.approvalId) throw new PermitIntelError(409, "Already sent to Product approvals");
    const a = await createApproval({ name: item.fileName ?? "approval.pdf", bytes: await readFile(key) }, actor);
    await prisma.permitAssistItem.update({ where: { id: itemId }, data: { approvalId: a.id } });
    await audit(actor, permit.id, "assist_approval", { itemId, approvalId: a.id });
    return { item: await prisma.permitAssistItem.findUnique({ where: { id: itemId }, select: ITEM_SELECT }), approval: a };
  }

  if (item.status !== "PROPOSED") throw new PermitIntelError(409, item.status === "ACCEPTED" ? "Already on the permit — change it on the Documents tab" : "Only a proposed document can be decided");

  if (d.action === "reject") {
    if (item.storageKey && !item.fileId) await deleteFile(item.storageKey);
    await prisma.permitAssistItem.update({ where: { id: itemId }, data: { status: "REJECTED", storageKey: item.fileId ? item.storageKey : null, decidedByUserId: actor.id, decidedAt: new Date() } });
    await audit(actor, permit.id, "assist_reject", { itemId, fileName: item.fileName, url: item.finalUrl ?? item.url });
    return { item: await prisma.permitAssistItem.findUnique({ where: { id: itemId }, select: ITEM_SELECT }), fileId: null };
  }

  if (!isPermitDocType(d.docType)) throw new PermitIntelError(400, "Pick a document type");
  let fileId = item.fileId;
  if (fileId) {
    await prisma.file.update({ where: { id: fileId }, data: { permitDocType: d.docType } });
  } else {
    if (!item.storageKey || !item.fileType) throw new PermitIntelError(409, "The fetched document is no longer held; run the assistant again");
    const f = await prisma.file.create({
      data: {
        leadId: permit.job.leadId,
        jobId: permit.jobId,
        permitId: permit.id,
        permitDocType: d.docType,
        fileName: item.fileName ?? "document",
        fileType: item.fileType,
        fileSize: item.sizeBytes ?? 0,
        storageKey: item.storageKey,
        category: "PERMIT",
        uploadedByUserId: actor.id,
      },
    });
    fileId = f.id;
  }
  await prisma.permitAssistItem.update({ where: { id: itemId }, data: { status: "ACCEPTED", fileId, decidedType: d.docType, decidedByUserId: actor.id, decidedAt: new Date() } });
  await audit(actor, permit.id, "assist_accept", { itemId, fileId, docType: d.docType, fileName: item.fileName, url: item.finalUrl ?? item.url, suggested: item.suggestedType });
  return { item: await prisma.permitAssistItem.findUnique({ where: { id: itemId }, select: ITEM_SELECT }), fileId };
}

/** A fetched document's bytes, to look at before deciding (PDFs and pictures only — a web page is never served from here). */
export async function assistItemBytes(itemId: string) {
  const item = await prisma.permitAssistItem.findUnique({ where: { id: itemId }, select: { storageKey: true, fileType: true, fileName: true, file: { select: { storageKey: true, fileType: true } } } });
  const key = item?.file?.storageKey ?? item?.storageKey;
  const type = item?.file?.fileType ?? item?.fileType;
  if (!item || !key || !type || !(type === "application/pdf" || READABLE_IMAGE.has(type))) throw new PermitIntelError(404, "Nothing to show for this item");
  return { bytes: await readFile(key), type, name: item.fileName ?? "document" };
}
