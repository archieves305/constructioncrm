import { z } from "zod";
import { permitDocLabel, PERMIT_DOC_TYPES } from "./doc-types";
import type { Finding } from "./preflight";

/**
 * Lessons, without the database. Pure and client-safe.
 *
 * A correction the department accepted once KNU answered it is something a
 * reviewer of that jurisdiction asks for. Such comments are grouped by
 * jurisdiction × permit type × category × what they affect; each group is
 * one lesson, PROPOSED until an administrator approves it. Approved lessons
 * are shown at preflight on permits of the same jurisdiction and type — as a
 * warning when their check fails, as a note otherwise.
 */
export const lessonGroupKey = (jurisdictionId: string | null, permitTypeKey: string | null, category: string, target: string) => `${jurisdictionId ?? "*"}|${permitTypeKey ?? "*"}|${category}|${target}`;

/**
 * A comment with the job's particulars taken out before it is generalised or
 * stored as a lesson: the address, the owner, the permit and application
 * numbers, parcel numbers, emails and phone numbers.
 */
export function scrub(text: string, terms: readonly (string | null | undefined)[]): string {
  let t = text;
  for (const term of terms) {
    const v = term?.trim();
    if (!v || v.length < 3) continue;
    t = t.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[…]");
  }
  return t
    .replace(/\b\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}-\d{4}\b/g, "[parcel]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]");
}

export type AcceptedItem = { id: string; permitId: string; jurisdictionId: string | null; permitTypeKey: string | null; category: string; affects: string; text: string };
export type ExistingLesson = { id: string; groupKey: string | null; status: string; sourceItemIds: string[] };

/**
 * New lessons for groups never seen, more occurrences for groups already
 * learned (a REJECTED group stays rejected but still counts). An item already
 * counted in a lesson is never counted again.
 */
export function planLessons(items: readonly AcceptedItem[], existing: readonly ExistingLesson[]): { create: { groupKey: string; jurisdictionId: string | null; permitTypeKey: string | null; category: string; target: string; items: AcceptedItem[] }[]; bump: { lessonId: string; itemIds: string[] }[] } {
  const counted = new Set(existing.flatMap((l) => l.sourceItemIds));
  const byKey = new Map(existing.filter((l) => l.groupKey && l.status !== "RETIRED").map((l) => [l.groupKey!, l]));
  const fresh = new Map<string, AcceptedItem[]>();
  const bumps = new Map<string, string[]>();
  for (const it of items) {
    if (counted.has(it.id)) continue;
    const key = lessonGroupKey(it.jurisdictionId, it.permitTypeKey, it.category, it.affects);
    const lesson = byKey.get(key);
    if (lesson) bumps.set(lesson.id, [...(bumps.get(lesson.id) ?? []), it.id]);
    else fresh.set(key, [...(fresh.get(key) ?? []), it]);
  }
  return {
    create: [...fresh.entries()].map(([groupKey, its]) => ({ groupKey, jurisdictionId: its[0].jurisdictionId, permitTypeKey: its[0].permitTypeKey, category: its[0].category, target: its[0].affects, items: its })),
    bump: [...bumps.entries()].map(([lessonId, itemIds]) => ({ lessonId, itemIds })),
  };
}

// ─── The generalised wording ────────────────────────────────────────────────

const docKeys = PERMIT_DOC_TYPES.map((t) => t.key) as [string, ...string[]];

export const generaliseSchema = z.object({
  title: z.string().describe("One imperative line a coordinator can check before submitting, general to any job — no address, owner, number or date."),
  body: z.string().describe("Two or three sentences: what the reviewer asked for and how to have it in the package."),
  requiresDocType: z.enum(docKeys).nullable().describe("Only when the comment says a kind of document was not submitted at all, its type. A comment about what a document must show or contain is null."),
});
export type Generalised = z.infer<typeof generaliseSchema>;

/** Without the AI: the first comment, shortened, as the title — a person rewrites it before approving. */
export function fallbackLesson(comments: readonly string[]): Generalised {
  const first = (comments[0] ?? "").replace(/\s+/g, " ").trim();
  return { title: first.length > 120 ? `${first.slice(0, 119)}…` : first || "Reviewer comment", body: comments.slice(0, 3).join("\n\n").slice(0, 1500), requiresDocType: null };
}

// ─── Machine checks and retrieval ───────────────────────────────────────────

export const lessonCheckSchema = z.object({ requiresDocType: z.enum(docKeys) }).nullable();
export type LessonCheck = z.infer<typeof lessonCheckSchema>;

export type LessonRow = { id: string; status: string; kind: string; jurisdictionId: string | null; permitTypeKey: string | null; title: string; body: string | null; check: unknown; occurrences: number; effectiveFrom: Date | null; effectiveTo: Date | null; lastSeenAt: Date | null };

/** The approved lessons for a permit, most specific first, then the most often seen. */
export function applicableLessons(rows: readonly LessonRow[], permit: { jurisdictionId: string | null; permitTypeKey: string | null }, on: Date): LessonRow[] {
  const spec = (l: LessonRow) => (l.jurisdictionId ? 2 : 0) + (l.permitTypeKey ? 1 : 0);
  return rows
    .filter((l) => l.kind === "LESSON" && l.status === "APPROVED")
    .filter((l) => (!l.jurisdictionId || l.jurisdictionId === permit.jurisdictionId) && (!l.permitTypeKey || l.permitTypeKey === permit.permitTypeKey))
    .filter((l) => (!l.effectiveFrom || l.effectiveFrom <= on) && (!l.effectiveTo || l.effectiveTo > on))
    .sort((a, b) => spec(b) - spec(a) || b.occurrences - a.occurrences || (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
}

/**
 * Lessons as preflight findings: a failed check (the document is not on the
 * permit) warns; otherwise the lesson is a note — a document being on file
 * does not mean it shows what the reviewer asked for.
 */
export function lessonFindings(lessons: readonly LessonRow[], documentTypes: readonly (string | null)[]): Finding[] {
  const have = new Set(documentTypes.filter(Boolean));
  return lessons.map((l): Finding => {
    const check = lessonCheckSchema.safeParse(l.check ?? null);
    const seen = l.occurrences > 1 ? ` (asked ${l.occurrences} times)` : "";
    if (check.success && check.data) {
      if (!have.has(check.data.requiresDocType))
        return { code: `lesson.${l.id}`, severity: "WARNING" as const, message: `Reviewers here have asked for this before${seen}: ${l.title}`, suggestion: `No ${permitDocLabel(check.data.requiresDocType).toLowerCase()} is on the permit${l.body ? `. ${l.body}` : ""}`, evidence: [{ kind: "tab" as const, ref: "documents" as const, label: "Documents" }], source: "rules" as const };
    }
    return { code: `lesson.${l.id}`, severity: "INFO" as const, message: `Reviewers here have asked for this before${seen}: ${l.title}`, suggestion: l.body ?? undefined, source: "rules" as const };
  });
}
