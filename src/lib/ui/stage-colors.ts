/**
 * A colour for every pipeline stage, derived from where the stage sits.
 *
 * Stages are database rows (admins add and reorder them), so a colour map
 * keyed by name rots. Instead: open stages are split into five phases by
 * order, running cool → warm (indigo, blue, teal, gold, orange); a closed
 * stage is green; a lost one red; a parked one grey. Neighbours share a
 * colour on purpose — fifteen adjacent hues are indistinguishable, and the
 * phase says "where in the lifecycle" at a glance. Never passes through
 * green or red for an open stage, because those mean done and overdue.
 *
 * Every class string is a complete literal (Tailwind v4 cannot see a
 * template), so consumers look a tone up and use what they get.
 */

export type StageLike = {
  id?: string;
  name: string;
  stageOrder: number;
  isClosed?: boolean;
  isWon?: boolean;
  isLost?: boolean;
};

export type StageToneKey =
  | "phase-0"
  | "phase-1"
  | "phase-2"
  | "phase-3"
  | "phase-4"
  | "done"
  | "lost"
  | "hold"
  | "neutral";

export type StageTone = {
  key: StageToneKey;
  /** Column accent bar / stepper connector. */
  bar: string;
  /** Small solid dot. */
  dot: string;
  /** Tinted pill: soft background + readable text. */
  pill: string;
  /** Text alone. */
  text: string;
  /** Focus/drop ring tint. */
  ring: string;
  /** Solid fill with white text (the current step). */
  solid: string;
};

export const PHASE_COUNT = 5;

/** Open stages that sit outside the progression. */
export const PARKED_STAGE_NAMES: ReadonlySet<string> = new Set(["On Hold"]);

export const STAGE_TONES: Record<StageToneKey, StageTone> = {
  "phase-0": {
    key: "phase-0",
    bar: "bg-stage-0",
    dot: "bg-stage-0",
    pill: "bg-stage-0-soft text-stage-0-fg",
    text: "text-stage-0-fg",
    ring: "ring-stage-0/40",
    solid: "bg-stage-0 text-white",
  },
  "phase-1": {
    key: "phase-1",
    bar: "bg-stage-1",
    dot: "bg-stage-1",
    pill: "bg-stage-1-soft text-stage-1-fg",
    text: "text-stage-1-fg",
    ring: "ring-stage-1/40",
    solid: "bg-stage-1 text-white",
  },
  "phase-2": {
    key: "phase-2",
    bar: "bg-stage-2",
    dot: "bg-stage-2",
    pill: "bg-stage-2-soft text-stage-2-fg",
    text: "text-stage-2-fg",
    ring: "ring-stage-2/40",
    solid: "bg-stage-2 text-white",
  },
  "phase-3": {
    key: "phase-3",
    bar: "bg-stage-3",
    dot: "bg-stage-3",
    pill: "bg-stage-3-soft text-stage-3-fg",
    text: "text-stage-3-fg",
    ring: "ring-stage-3/40",
    solid: "bg-stage-3 text-white",
  },
  "phase-4": {
    key: "phase-4",
    bar: "bg-stage-4",
    dot: "bg-stage-4",
    pill: "bg-stage-4-soft text-stage-4-fg",
    text: "text-stage-4-fg",
    ring: "ring-stage-4/40",
    solid: "bg-stage-4 text-white",
  },
  done: {
    key: "done",
    bar: "bg-stage-done",
    dot: "bg-stage-done",
    pill: "bg-stage-done-soft text-stage-done-fg",
    text: "text-stage-done-fg",
    ring: "ring-stage-done/40",
    solid: "bg-stage-done text-white",
  },
  lost: {
    key: "lost",
    bar: "bg-stage-lost",
    dot: "bg-stage-lost",
    pill: "bg-stage-lost-soft text-stage-lost-fg",
    text: "text-stage-lost-fg",
    ring: "ring-stage-lost/40",
    solid: "bg-stage-lost text-white",
  },
  hold: {
    key: "hold",
    bar: "bg-stage-hold",
    dot: "bg-stage-hold",
    pill: "bg-stage-hold-soft text-stage-hold-fg",
    text: "text-stage-hold-fg",
    ring: "ring-stage-hold/40",
    solid: "bg-stage-hold text-white",
  },
  neutral: {
    key: "neutral",
    bar: "bg-gray-300",
    dot: "bg-gray-400",
    pill: "bg-gray-100 text-gray-700",
    text: "text-gray-700",
    ring: "ring-gray-300",
    solid: "bg-gray-500 text-white",
  },
};

function isParked(s: StageLike): boolean {
  return PARKED_STAGE_NAMES.has(s.name);
}

function isOpenProgression(s: StageLike): boolean {
  return !s.isClosed && !s.isLost && !s.isWon && !isParked(s);
}

function sameStage(a: StageLike, b: StageLike): boolean {
  return a.id && b.id ? a.id === b.id : a.name === b.name;
}

export function stageToneKey(stage: StageLike, all: StageLike[]): StageToneKey {
  if (stage.isLost) return "lost";
  if (stage.isClosed || stage.isWon) return "done";
  if (isParked(stage)) return "hold";
  const open = all.filter(isOpenProgression).sort((a, b) => a.stageOrder - b.stageOrder);
  const i = open.findIndex((s) => sameStage(s, stage));
  if (i < 0 || open.length === 0) return "neutral";
  const phase = Math.min(PHASE_COUNT - 1, Math.floor((i * PHASE_COUNT) / open.length));
  return `phase-${phase}` as StageToneKey;
}

/**
 * Resolve a stage (row, or just its name) against the full list. A name
 * that is not in the list, or no list at all, is neutral rather than a crash.
 */
export function stageTone(stage: StageLike | string | null | undefined, all: StageLike[] | undefined): StageTone {
  if (!stage) return STAGE_TONES.neutral;
  const list = all ?? [];
  const row = typeof stage === "string" ? list.find((s) => s.name === stage) : stage;
  if (!row) return STAGE_TONES.neutral;
  return STAGE_TONES[stageToneKey(row, list)];
}

/** Precompute for lists: keyed by id and by name. */
export function buildStageToneMap(all: StageLike[]): Map<string, StageTone> {
  const m = new Map<string, StageTone>();
  for (const s of all) {
    const tone = STAGE_TONES[stageToneKey(s, all)];
    if (s.id) m.set(s.id, tone);
    m.set(s.name, tone);
  }
  return m;
}
