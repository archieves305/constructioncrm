import { dayKey, type DayKey } from "@/lib/time/zone";
import { projectNameKey } from "../states";
import { PLANHUB_STAGE_LABEL, type BoardCard, type PlanhubStageKey } from "./parse";

/**
 * What a "Send to CRM" would change, before a person applies it. Pure and
 * client-safe: the service hands it the CRM's rows, the review screen shows
 * the result. Nothing here moves a bid's status — a PlanHub stage is mirrored
 * on the project, and Submitted / Won / Lost only become suggestions
 * (`planhubSuggestion`) a person acts on.
 */

export type BoardProjectCandidate = {
  id: string;
  number: string;
  name: string;
  planhubName: string | null;
  planhubStage: PlanhubStageKey | null;
  planhubDueAt: Date | string | null;
};

export type Change = { field: "stage" | "due" | "name"; label: string; from: string | null; to: string | null };

export type BoardRow = {
  index: number;
  card: BoardCard;
  match: { id: string; number: string; name: string } | null;
  /** More than one CRM project carries this name: a person picks. */
  ambiguous: { id: string; number: string; name: string }[];
  action: "create" | "update" | "same";
  changes: Change[];
};

const dueKeyOf = (d: Date | string | null): DayKey | null => (d ? dayKey(new Date(d)) : null);
export const stageLabel = (s: PlanhubStageKey | null | undefined) => (s ? PLANHUB_STAGE_LABEL[s] : null);

/** A board card is the project whose PlanHub name (else its own name) reads the same. */
export function matchCard(card: BoardCard, projects: readonly BoardProjectCandidate[]): BoardProjectCandidate[] {
  const key = projectNameKey(card.name);
  if (!key) return [];
  const byPlanhub = projects.filter((p) => p.planhubName && projectNameKey(p.planhubName) === key);
  if (byPlanhub.length) return byPlanhub;
  return projects.filter((p) => projectNameKey(p.name) === key);
}

export function cardChanges(card: BoardCard, p: BoardProjectCandidate | null): Change[] {
  const out: Change[] = [];
  if (card.stage && card.stage !== p?.planhubStage) out.push({ field: "stage", label: "PlanHub column", from: stageLabel(p?.planhubStage), to: stageLabel(card.stage) });
  const due = dueKeyOf(p?.planhubDueAt ?? null);
  if (card.dueOn && card.dueOn !== due) out.push({ field: "due", label: "Due to the GC", from: due, to: card.dueOn });
  return out;
}

export function planBoard(cards: readonly BoardCard[], projects: readonly BoardProjectCandidate[]): BoardRow[] {
  return cards.map((card, index) => {
    const hits = matchCard(card, projects);
    const match = hits.length === 1 ? hits[0] : null;
    const changes = cardChanges(card, match);
    return {
      index,
      card,
      match: match ? { id: match.id, number: match.number, name: match.name } : null,
      ambiguous: hits.length > 1 ? hits.map((h) => ({ id: h.id, number: h.number, name: h.name })) : [],
      action: hits.length === 0 ? "create" : changes.length ? "update" : "same",
      changes: hits.length === 0 ? cardChanges(card, null) : changes,
    };
  });
}

/** What changes on a matched project from a card: only PlanHub's own fields. */
export function boardUpdate(card: BoardCard, p: Pick<BoardProjectCandidate, "planhubStage" | "planhubDueAt" | "planhubName">, now: Date): {
  planhubName?: string;
  planhubStage?: PlanhubStageKey;
  planhubStageAt?: Date;
  planhubDueAt?: Date;
  planhubSeenAt: Date;
} {
  const out: ReturnType<typeof boardUpdate> = { planhubSeenAt: now };
  if (!p.planhubName) out.planhubName = card.name;
  if (card.stage && card.stage !== p.planhubStage) {
    out.planhubStage = card.stage;
    out.planhubStageAt = now;
  }
  if (card.dueOn && card.dueOn !== dueKeyOf(p.planhubDueAt)) out.planhubDueAt = dueInstant(card.dueOn);
  return out;
}

/** A card's due day as an instant: noon UTC, the CRM's all-day convention. */
export function dueInstant(k: DayKey): Date {
  return new Date(`${k}T12:00:00.000Z`);
}

/** A project page fills only what the CRM does not have yet; a person's own values stay. */
export type FillField = "name" | "address1" | "city" | "state" | "zipCode" | "projectType" | "platformRef" | "platformUrl";
export function projectFills(
  page: { name: string | null; address: { address1: string | null; city: string | null; state: string | null; zipCode: string | null } | null; projectType: string | null; platformRef: string; platformUrl: string },
  current: Partial<Record<FillField, string | null>> | null,
): { field: FillField; to: string }[] {
  const want: Record<FillField, string | null> = {
    name: page.name,
    address1: page.address?.address1 ?? null,
    city: page.address?.city ?? null,
    state: page.address?.state ?? null,
    zipCode: page.address?.zipCode ?? null,
    projectType: page.projectType,
    platformRef: page.platformRef,
    platformUrl: page.platformUrl,
  };
  return (Object.keys(want) as FillField[]).filter((f) => want[f] && !current?.[f]?.trim()).map((f) => ({ field: f, to: want[f]! }));
}

/** PlanHub's trade names that read as one of the CRM's trades. */
export function tradeMatches(trades: readonly string[], categories: readonly { id: string; name: string }[]): { trade: string; serviceCategoryId: string | null }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return trades.map((trade) => {
    const t = norm(trade);
    const exact = categories.find((c) => norm(c.name) === t);
    if (exact) return { trade, serviceCategoryId: exact.id };
    const word = categories.filter((c) => {
      const n = norm(c.name);
      return n.length >= 4 && new RegExp(`(^| )${n}s?( |$)`).test(t);
    });
    return { trade, serviceCategoryId: word.length === 1 ? word[0].id : null };
  });
}

export type SuggestionKind = "ADD_GC" | "RECORD_SENT" | "RECORD_AWARD" | "MARK_LOST";
export type Suggestion = { kind: SuggestionKind; text: string };

/**
 * What PlanHub's column asks of the CRM, if anything — derived on read, so it
 * disappears once the record says the same. Saved / Estimating / Bidding ask
 * nothing.
 */
export function planhubSuggestion(p: {
  planhubStage: PlanhubStageKey | null;
  opportunities: readonly { submissions: number; awards: number; scopes: readonly { status: string }[] }[];
}): Suggestion | null {
  const s = p.planhubStage;
  if (s !== "SUBMITTED" && s !== "WON" && s !== "LOST") return null;
  const label = PLANHUB_STAGE_LABEL[s];
  if (p.opportunities.length === 0) return { kind: "ADD_GC", text: `PlanHub shows this as ${label}, but no GC is on it here. Open the project on PlanHub and click Send to CRM to add the GC.` };
  if (s === "SUBMITTED" && !p.opportunities.some((o) => o.submissions > 0)) return { kind: "RECORD_SENT", text: "PlanHub shows this as Submitted. Record the proposal as sent below." };
  if (s === "WON" && !p.opportunities.some((o) => o.awards > 0)) return { kind: "RECORD_AWARD", text: "PlanHub shows this as Won. Record the award on the GC that chose KNU." };
  if (s === "LOST" && p.opportunities.some((o) => o.scopes.some((x) => x.status === "PENDING" || x.status === "VERBAL"))) return { kind: "MARK_LOST", text: "PlanHub shows this as Lost. Mark the open scopes lost (click a scope)." };
  return null;
}
