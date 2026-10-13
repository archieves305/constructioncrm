import type { PartnerStage } from "@/generated/prisma/enums";
import type { StageLike } from "@/lib/ui/stage-colors";

/**
 * The relationship pipeline: six hand-moved stages. Everything else about an
 * account (prequalified, bidding, awarded, quiet…) is a fact the CRM reads
 * from its own records (derive.ts), never a stage someone must remember to
 * move. An enum rather than a table: the follow-up rules key on the stage's
 * meaning, and a renamed row would silently break them (the lead stages
 * carry a dozen such name dependencies today).
 */
export type PartnerStageDef = {
  key: PartnerStage;
  name: string;
  stageOrder: number;
  /** Parked or written off: out of the board's open columns and the follow-up rules. */
  isClosed: boolean;
  hint: string;
};

export const PARTNER_STAGES: readonly PartnerStageDef[] = [
  { key: "TARGET", name: "Target", stageOrder: 1, isClosed: false, hint: "Identified; nobody there has talked to us yet" },
  { key: "CONTACTED", name: "Contacted", stageOrder: 2, isClosed: false, hint: "Two-way contact: someone replied or took the call" },
  { key: "ENGAGED", name: "Engaged", stageOrder: 3, isClosed: false, hint: "A meeting or site visit happened; the relationship is live" },
  { key: "ACTIVE", name: "Active", stageOrder: 4, isClosed: false, hint: "They send us bids, or we have worked for them" },
  { key: "DORMANT", name: "Dormant", stageOrder: 5, isClosed: true, hint: "Parked on purpose; no follow-ups until it is moved back" },
  { key: "DO_NOT_PURSUE", name: "Do not pursue", stageOrder: 6, isClosed: true, hint: "Written off, with a reason" },
];

export const PARTNER_STAGE_KEYS: readonly PartnerStage[] = PARTNER_STAGES.map((s) => s.key);

export const STAGE_TERMINAL: ReadonlySet<PartnerStage> = new Set(PARTNER_STAGES.filter((s) => s.isClosed).map((s) => s.key));

export function stageDef(key: PartnerStage): PartnerStageDef {
  const def = PARTNER_STAGES.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown partner stage ${key}`);
  return def;
}

export function stageName(key: PartnerStage): string {
  return stageDef(key).name;
}

export function isPartnerStage(v: unknown): v is PartnerStage {
  return typeof v === "string" && (PARTNER_STAGE_KEYS as readonly string[]).includes(v);
}

/** The stages as the kanban kit, the stepper and the pill select expect them (`id` = the enum key). */
export function stagesAsStageLike(): (StageLike & { id: PartnerStage })[] {
  return PARTNER_STAGES.map((s) => ({ id: s.key, name: s.name, stageOrder: s.stageOrder, isClosed: s.isClosed }));
}

/** A move into a written-off stage needs a reason on the record. */
export function stageNeedsReason(to: PartnerStage): boolean {
  return to === "DO_NOT_PURSUE";
}
