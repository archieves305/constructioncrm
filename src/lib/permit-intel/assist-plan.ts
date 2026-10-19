import { permitDocLabel } from "./doc-types";
import type { AssistRead } from "./prompts/assist-read";
import type { FoundLink } from "./links";
import { MAX_PICKS } from "./prompts/assist-read";

/**
 * The permit assistant's bookkeeping, without the database. Pure and
 * client-safe: what the AI's answer means, and how the documents found line
 * up with the jurisdiction's checklist.
 */
export type Findings = Pick<AssistRead, "asks" | "approvalNumbers" | "deadlines" | "relevant">;

/** Fetches per run: enough for a department's few relevant pages and the forms they link. */
export const MAX_FETCHES_PER_RUN = 40;
/** Documents per run a person may hand the assistant at once. */
export const MAX_UPLOADS_PER_RUN = 40;

/** The links the AI picked, by number: unknown numbers dropped, each once, at most a handful. */
export function pickedLinks(picks: AssistRead["openLinks"], links: readonly FoundLink[]): (FoundLink & { reason: string })[] {
  const byId = new Map(links.map((l) => [l.id, l]));
  const out: (FoundLink & { reason: string })[] = [];
  const seen = new Set<number>();
  for (const p of picks) {
    const l = byId.get(p.id);
    if (!l || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ ...l, reason: p.reason.trim().slice(0, 300) });
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

export type PlanRequirement = { id: string; title: string; documentType: string | null; required: boolean };
export type PlanFile = { id: string; fileName: string; permitDocType: string | null; missing?: boolean };
export type PlanItem = { id: string; status: string; title: string | null; fileName: string | null; suggestedType: string | null; decidedType: string | null; sha256: string | null; findings: Findings | null; source: string };

export type CoverageLine = { requirement: PlanRequirement; state: "covered" | "proposed" | "missing" | "by_hand"; files: PlanFile[]; items: PlanItem[] };

const typeOf = (i: PlanItem) => i.decidedType ?? i.suggestedType;

/**
 * Each checklist line: covered by a document on the permit, proposed by an
 * item waiting on a person, missing — or "by hand" when the line names no
 * document type.
 */
export function coverage(reqs: readonly PlanRequirement[], files: readonly PlanFile[], items: readonly PlanItem[]): CoverageLine[] {
  const live = files.filter((f) => !f.missing);
  const waiting = items.filter((i) => i.status === "PROPOSED");
  return reqs.map((r) => {
    if (!r.documentType) return { requirement: r, state: "by_hand", files: [], items: [] };
    const f = live.filter((x) => x.permitDocType === r.documentType);
    const it = waiting.filter((x) => typeOf(x) === r.documentType);
    return { requirement: r, state: f.length ? "covered" : it.length ? "proposed" : "missing", files: f, items: it };
  });
}

export type Ask = { what: string; docType: string | null; sources: { itemId: string; title: string; page: number | null; quote: string }[]; onFile: boolean; onChecklist: boolean; fromYourDocuments: boolean };

/**
 * What the documents and pages say the application needs, merged across
 * items (the same document type, or the same words, is one line), each with
 * where it was read; marked when the permit already has it, when the
 * checklist already asks for it, and when one of the person's own documents
 * says it (a department's general pages say a great deal more).
 */
export function askedFor(items: readonly PlanItem[], files: readonly PlanFile[], reqs: readonly PlanRequirement[]): Ask[] {
  const have = new Set(files.filter((f) => !f.missing && f.permitDocType).map((f) => f.permitDocType!));
  const listed = new Set(reqs.map((r) => r.documentType).filter(Boolean) as string[]);
  const out = new Map<string, Ask>();
  for (const i of items) {
    if (i.status === "REJECTED" || i.status === "FAILED" || !i.findings) continue;
    for (const a of i.findings.asks ?? []) {
      const what = a.what.trim();
      if (!what) continue;
      const key = a.docType && a.docType !== "other" ? `t:${a.docType}` : `w:${what.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      const line = out.get(key) ?? { what: a.docType && a.docType !== "other" ? permitDocLabel(a.docType) : what, docType: a.docType && a.docType !== "other" ? a.docType : null, sources: [], onFile: false, onChecklist: false, fromYourDocuments: false };
      line.sources.push({ itemId: i.id, title: i.title ?? i.fileName ?? "a document", page: a.page, quote: a.quote.slice(0, 300) });
      if (i.source === "UPLOAD") line.fromYourDocuments = true;
      out.set(key, line);
    }
  }
  return [...out.values()]
    .map((l) => ({ ...l, onFile: !!l.docType && have.has(l.docType), onChecklist: !!l.docType && listed.has(l.docType) }))
    .sort((a, b) => Number(b.fromYourDocuments) - Number(a.fromYourDocuments) || Number(a.onFile) - Number(b.onFile) || b.sources.length - a.sources.length);
}

/** Items with the same bytes as an earlier item of the run: the later ones are copies. */
export function duplicateOf(items: readonly PlanItem[]): Map<string, string> {
  const first = new Map<string, string>();
  const dup = new Map<string, string>();
  for (const i of items) {
    if (!i.sha256) continue;
    const seen = first.get(i.sha256);
    if (seen) dup.set(i.id, seen);
    else first.set(i.sha256, i.id);
  }
  return dup;
}

/** Product approval numbers the documents name, once each, with where they were read. */
export function approvalNumbers(items: readonly PlanItem[]): { number: string; itemId: string; page: number | null; quote: string }[] {
  const out = new Map<string, { number: string; itemId: string; page: number | null; quote: string }>();
  for (const i of items) {
    if (i.status === "REJECTED" || !i.findings) continue;
    for (const n of i.findings.approvalNumbers ?? []) {
      const key = n.number.replace(/\s+/g, "").toUpperCase();
      if (key && !out.has(key)) out.set(key, { number: n.number.trim(), itemId: i.id, page: n.page, quote: n.quote.slice(0, 300) });
    }
  }
  return [...out.values()];
}
