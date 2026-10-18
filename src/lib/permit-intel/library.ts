import { Prisma, type RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { jobAccessWhere } from "@/lib/access/records";
import { runAiCall } from "@/lib/ai/calls";
import { FILE_LIST_INCLUDE, presentFiles } from "@/lib/files/list";
import { joinPages, readPdfText } from "@/lib/files/pdf-text";
import { readFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { permitDocLabel } from "./doc-types";
import * as classify from "./prompts/file-classify";
import { PermitIntelError } from "./service";

/**
 * The Permit Library: every permit document across jobs, filtered by
 * jurisdiction, permit type and document type, and searched in full text
 * (the file name and the text read from a PDF — `files.search_vector`, a
 * generated tsvector with a GIN index). It also suggests the type of an
 * unclassified document. Reads follow the viewer's job scope.
 */
type Viewer = { id: string; role: RoleName };

/** Read a permit PDF's text once, for search and classification. Never throws. */
export async function indexPermitFileText(fileId: string): Promise<string | null> {
  try {
    const f = await prisma.file.findUnique({ where: { id: fileId }, select: { id: true, permitId: true, fileType: true, storageKey: true, extractedText: true } });
    if (!f?.permitId || f.fileType !== "application/pdf") return null;
    if (f.extractedText != null) return f.extractedText;
    const text = await readPdfText(await readFile(f.storageKey));
    // a scan reads as empty: stored as "" so it is not read again
    const joined = text ? joinPages(text) : "";
    await prisma.file.update({ where: { id: f.id }, data: { extractedText: joined } });
    return joined;
  } catch (err) {
    logger.warn("permit file text not indexed", { fileId, message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The AI's suggestion for an unclassified document's type; nothing is stored on the file. */
export async function suggestDocType(fileId: string, userId: string) {
  const f = await prisma.file.findUnique({ where: { id: fileId }, select: { id: true, permitId: true, fileName: true, fileType: true } });
  if (!f?.permitId) throw new PermitIntelError(404, "Permit document not found");
  if (f.fileType !== "application/pdf") throw new PermitIntelError(400, "Only a PDF's text can be read to suggest its type");
  const text = ((await indexPermitFileText(f.id)) ?? "").trim();
  if (text.length < 40) throw new PermitIntelError(400, "This PDF has no readable text (it is probably a scan). Pick its type by hand.");
  const r = await runAiCall({
    subjectType: "permit_file",
    subjectId: f.id,
    purpose: classify.PURPOSE,
    promptVersion: classify.PROMPT_VERSION,
    schema: classify.schema,
    inputs: { fileName: f.fileName, text: text.slice(0, classify.MAX_CHARS) },
    system: classify.SYSTEM,
    content: classify.content(f.fileName, text),
    model: classify.MODEL,
    effort: "low",
    maxTokens: 2_000,
    userId,
  });
  return { docType: r.output.docType, label: permitDocLabel(r.output.docType), confidence: Math.min(1, Math.max(0, r.output.confidence)), reason: r.output.reason.slice(0, 300), cached: r.cached };
}

export type LibraryQuery = {
  q?: string | null;
  jurisdictionId?: string | null;
  permitTypeKey?: string | null;
  docType?: string | null;
  submittedOnly?: boolean;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
};

/** Ids matching a full-text query, best first, with a highlighted snippet of the text. */
async function textMatches(q: string, limit: number): Promise<{ id: string; rank: number; snippet: string | null }[]> {
  return prisma.$queryRaw<{ id: string; rank: number; snippet: string | null }[]>(Prisma.sql`
    SELECT f.id,
           ts_rank(f.search_vector, query) AS rank,
           CASE WHEN f.extracted_text IS NULL OR f.extracted_text = '' THEN NULL
                ELSE ts_headline('english', left(f.extracted_text, 100000), query, 'StartSel=[[, StopSel=]], MaxWords=24, MinWords=8, MaxFragments=2, FragmentDelimiter= … ')
           END AS snippet
      FROM files f, websearch_to_tsquery('english', ${q}) query
     WHERE f.permit_id IS NOT NULL AND f.search_vector @@ query
     ORDER BY rank DESC
     LIMIT ${limit}`);
}

export async function searchLibrary(query: LibraryQuery, viewer: Viewer) {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
  const q = query.q?.trim() ?? "";
  const matches = q ? await textMatches(q, 500) : null;
  const where: Prisma.FileWhereInput = {
    permitId: { not: null },
    permit: {
      job: jobAccessWhere(viewer),
      ...(query.jurisdictionId ? { jurisdictionId: query.jurisdictionId } : {}),
      ...(query.permitTypeKey ? { permitTypeKey: query.permitTypeKey } : {}),
    },
    ...(query.docType ? (query.docType === "unclassified" ? { permitDocType: null } : { permitDocType: query.docType }) : {}),
    ...(query.submittedOnly ? { permitSubmissions: { some: {} } } : {}),
    ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    ...(matches ? { id: { in: matches.map((m) => m.id) } } : {}),
  };
  const rows = await prisma.file.findMany({
    where,
    include: { ...FILE_LIST_INCLUDE, permit: { select: { id: true, permitType: true, permitTypeKey: true, municipality: true, status: true, permitNumber: true, applicationNumber: true, jurisdiction: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: matches ? undefined : limit,
  });
  const byMatch = matches ? new Map(matches.map((m, i) => [m.id, { order: i, snippet: m.snippet }])) : null;
  const ordered = byMatch ? [...rows].sort((a, b) => byMatch.get(a.id)!.order - byMatch.get(b.id)!.order).slice(0, limit) : rows;
  const presented = await presentFiles(ordered);
  const permitOf = new Map(ordered.map((r) => [r.id, r.permit]));
  return {
    files: presented.map((f) => ({ ...f, permit: permitOf.get(f.id)!, snippet: byMatch?.get(f.id)?.snippet ?? null })),
    total: matches ? Math.min(rows.length, matches.length) : rows.length,
    searched: !!q,
  };
}
