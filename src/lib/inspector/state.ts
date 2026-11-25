import { iou, toStoredBox, type Box, type Tier } from "./boxes";
import { isTradeKey } from "./catalog";
import type { AreaAnswer } from "./prompt";

/**
 * The inspection's rules. Pure.
 *
 * - An answer becomes PROPOSED findings; nothing else changes until a person
 *   reviews them.
 * - A finding the area already holds (same trade, near-same title, same
 *   photo or overlapping box) is not proposed twice.
 * - Acceptance is a person's act. It waits for every analysis and every
 *   proposed finding; an open confirmed finding, a CRITICAL one, or an area
 *   the AI could not judge needs an ADMIN / MANAGER and a reason.
 */
export type Severity = "CRITICAL" | "MAJOR" | "MINOR" | "COSMETIC";
export type Review = "PROPOSED" | "CONFIRMED" | "DISMISSED";
export type Verdict = "looks_complete" | "issues_found" | "cannot_tell";

export const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2, COSMETIC: 3 };
export const SEVERITY_LABEL: Record<Severity, string> = { CRITICAL: "Critical", MAJOR: "Major", MINOR: "Minor", COSMETIC: "Cosmetic" };

export const DISMISS_REASONS = ["false_positive", "not_this_contractor", "out_of_scope", "duplicate", "other"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_LABEL: Record<DismissReason, string> = {
  false_positive: "Not a real problem",
  not_this_contractor: "Not this contractor's work",
  out_of_scope: "Outside the scope",
  duplicate: "Already recorded",
  other: "Other",
};

/** The punch item's priority from a finding's severity. */
export function priorityFor(severity: Severity): "URGENT" | "HIGH" | "MEDIUM" | "LOW" {
  return severity === "CRITICAL" ? "URGENT" : severity === "MAJOR" ? "HIGH" : severity === "MINOR" ? "MEDIUM" : "LOW";
}

/** The worse of two verdicts: issues found, then cannot tell, then looks complete. */
export function worseVerdict(a: Verdict | null, b: Verdict): Verdict {
  const rank: Record<Verdict, number> = { issues_found: 0, cannot_tell: 1, looks_complete: 2 };
  if (!a) return b;
  return rank[a] <= rank[b] ? a : b;
}

const STOP = new Set(["the", "a", "an", "on", "at", "in", "of", "to", "and", "or", "with", "near", "is", "are", "left", "right"]);
function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
}
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export type KnownFinding = { id: string; trade: string | null; title: string; photoIds: readonly string[]; boxes: readonly Box[]; boxPhotoId: string | null };

/** The existing finding a new one repeats, if any. */
export function sameAs(
  candidate: { trade: string | null; title: string; photoIds: readonly string[]; box: Box | null; boxPhotoId: string | null },
  known: readonly KnownFinding[],
): KnownFinding | null {
  for (const k of known) {
    if ((k.trade ?? "general") !== (candidate.trade ?? "general")) continue;
    if (titleSimilarity(k.title, candidate.title) < 0.5) continue;
    const samePhoto = candidate.photoIds.some((p) => k.photoIds.includes(p));
    const overlapping = !!candidate.box && candidate.boxPhotoId === k.boxPhotoId && k.boxes.some((b) => iou(b, candidate.box!) >= 0.3);
    if (samePhoto || overlapping) return k;
  }
  return null;
}

export type AnswerPhoto = { n: number; id: string; width: number; height: number };

export type NewFinding = {
  photoId: string;
  relatedPhotoIds: string[];
  kind: AreaAnswer["findings"][number]["kind"];
  severity: Severity;
  confidence: number;
  trade: string;
  title: string;
  evidence: string;
  action: string | null;
  physicalCheck: string | null;
  boxes: Box[];
  aiOriginal: AreaAnswer["findings"][number];
};

export type PlannedAnswer = {
  findings: NewFinding[];
  /** Repeats of a finding already on the area: the photo ids to add to it. */
  repeats: { findingId: string; photoIds: string[] }[];
  photoQuality: { photoId: string; quality: string }[];
  verdict: Verdict;
  summary: string;
  photosNeeded: string[];
};

/** An answer to rows, against the area's existing findings. A finding naming no photo it was given is dropped. */
export function planAnswer(answer: AreaAnswer, photos: readonly AnswerPhoto[], tier: Tier, known: readonly KnownFinding[]): PlannedAnswer {
  const byN = new Map(photos.map((p) => [p.n, p]));
  const findings: NewFinding[] = [];
  const repeats = new Map<string, Set<string>>();
  const seen: KnownFinding[] = [...known];
  for (const f of answer.findings) {
    const main = byN.get(f.photo);
    if (!main) continue;
    const related = [...new Set(f.alsoIn.map((n) => byN.get(n)?.id).filter((id): id is string => !!id && id !== main.id))];
    const box = f.box.length ? toStoredBox(f.box, main, tier) : null;
    const trade = isTradeKey(f.trade) ? f.trade : "general";
    const title = f.title.trim().slice(0, 200) || "Finding";
    const photoIds = [main.id, ...related];
    const dup = sameAs({ trade, title, photoIds, box, boxPhotoId: main.id }, seen);
    if (dup) {
      const set = repeats.get(dup.id) ?? new Set<string>();
      for (const p of photoIds) if (!dup.photoIds.includes(p)) set.add(p);
      repeats.set(dup.id, set);
      continue;
    }
    const confidence = Math.max(0, Math.min(1, f.confidence));
    findings.push({
      photoId: main.id,
      relatedPhotoIds: related,
      kind: f.kind,
      severity: f.severity,
      confidence,
      trade,
      title,
      evidence: f.evidence.trim().slice(0, 4000),
      action: f.action.trim() ? f.action.trim().slice(0, 2000) : null,
      physicalCheck: f.physicalCheck.trim() ? f.physicalCheck.trim().slice(0, 1000) : null,
      boxes: box ? [box] : [],
      aiOriginal: f,
    });
    // a later finding in the same answer is checked against this one too
    seen.push({ id: `new:${findings.length}`, trade, title, photoIds, boxes: box ? [box] : [], boxPhotoId: main.id });
  }
  const photoQuality: { photoId: string; quality: string }[] = [];
  for (const p of answer.photos) {
    const id = byN.get(p.n)?.id;
    if (id) photoQuality.push({ photoId: id, quality: p.quality });
  }
  return {
    findings,
    repeats: [...repeats].filter(([id, s]) => !id.startsWith("new:") && s.size).map(([findingId, s]) => ({ findingId, photoIds: [...s] })),
    photoQuality,
    verdict: answer.verdict,
    summary: answer.summary.trim().slice(0, 2000),
    photosNeeded: answer.photosNeeded.map((s) => s.trim()).filter(Boolean).slice(0, 8),
  };
}

// ── The inspection as a whole ─────────────────────────────────────────────

export type FindingFacts = { review: Review; severity: Severity; resolvedAt: Date | null; punchDone: boolean };
export type InspectionFacts = {
  status: "OPEN" | "ACCEPTED" | "CLOSED";
  pendingAnalyses: number;
  failedAnalyses: number;
  photos: number;
  findings: readonly FindingFacts[];
  areaVerdicts: readonly (Verdict | null)[];
};

export function findingResolved(f: Pick<FindingFacts, "resolvedAt" | "punchDone">): boolean {
  return !!f.resolvedAt || f.punchDone;
}

export type Phase = "empty" | "analysing" | "review" | "corrections" | "ready" | "accepted" | "closed";
export const PHASE_LABEL: Record<Phase, string> = {
  empty: "No photos yet",
  analysing: "Analysing",
  review: "Findings to review",
  corrections: "Corrections open",
  ready: "Ready to accept",
  accepted: "Accepted",
  closed: "Closed",
};

export function phaseOf(i: InspectionFacts): Phase {
  if (i.status === "ACCEPTED") return "accepted";
  if (i.status === "CLOSED") return "closed";
  if (!i.photos && !i.findings.length) return "empty";
  if (i.pendingAnalyses) return "analysing";
  if (i.findings.some((f) => f.review === "PROPOSED")) return "review";
  if (i.findings.some((f) => f.review === "CONFIRMED" && !findingResolved(f))) return "corrections";
  return "ready";
}

export type AcceptCheck = { hard: string[]; overridable: string[] };

/** What stands in the way of accepting. Hard ones no one can pass; the rest need an ADMIN / MANAGER and a reason. */
export function acceptBlockers(i: InspectionFacts): AcceptCheck {
  const hard: string[] = [];
  const overridable: string[] = [];
  if (i.status !== "OPEN") hard.push("The inspection is not open.");
  if (i.pendingAnalyses) hard.push("Photos are still being analysed.");
  const proposed = i.findings.filter((f) => f.review === "PROPOSED").length;
  if (proposed) hard.push(`${proposed} finding${proposed === 1 ? "" : "s"} still to review.`);
  const confirmedOpen = i.findings.filter((f) => f.review === "CONFIRMED" && !findingResolved(f));
  const critical = confirmedOpen.filter((f) => f.severity === "CRITICAL").length;
  if (critical) overridable.push(`${critical} critical finding${critical === 1 ? " is" : "s are"} not fixed.`);
  const otherOpen = confirmedOpen.length - critical;
  if (otherOpen) overridable.push(`${otherOpen} confirmed finding${otherOpen === 1 ? " is" : "s are"} not fixed yet.`);
  const unclear = i.areaVerdicts.filter((v) => v === "cannot_tell").length;
  if (unclear) overridable.push(`The AI could not judge ${unclear} area${unclear === 1 ? "" : "s"} from the photos.`);
  if (i.failedAnalyses) overridable.push(`${i.failedAnalyses} photo batch${i.failedAnalyses === 1 ? "" : "es"} could not be analysed.`);
  return { hard, overridable };
}
