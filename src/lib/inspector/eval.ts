import { iou, type Box } from "./boxes";
import { SEVERITY_ORDER, titleSimilarity, type Severity } from "./state";

/**
 * Scoring the AI against a person's review (Phase 1b eval). Pure.
 *
 * The truth of a case (one area's photos) is what a person decided:
 * a CONFIRMED finding — the AI's, or one the person added because the AI
 * missed it — is a real defect; a DISMISSED one is a known false alarm.
 * A model's answer on the same photos is matched to the truth one-to-one:
 *
 * - a pair must share a photo (the finding's photo or one it is "also in");
 * - on the same photo with both boxes, overlapping boxes match; otherwise the
 *   titles must say much the same thing, or — with no box to go by — the
 *   trade must agree and the titles share a word;
 * - the best-scoring pairs are taken first (box overlap, then title, then trade).
 *
 * Unmatched predictions are false positives; unmatched truth is missed. A
 * false positive that matches a dismissed finding is a repeated false alarm.
 * Box hit = a matched pair whose boxes on the same photo overlap at IoU ≥ 0.3.
 */
export const BOX_HIT_IOU = 0.3;
const MATCH_IOU = 0.1;
const MATCH_TITLE = 0.25;

export type EvalItem = {
  /** The photo key it is shown on best. */
  photo: string;
  /** Other photos showing it. */
  also?: readonly string[];
  title: string;
  severity: Severity;
  trade: string;
  box: Box | null;
};

export type TruthItem = EvalItem & { source: "AI" | "PERSON" };

export type Pair = { truth: number; pred: number; iou: number | null; title: number };

function shares(a: EvalItem, b: EvalItem): boolean {
  const pa = new Set([a.photo, ...(a.also ?? [])]);
  return pa.has(b.photo) || (b.also ?? []).some((p) => pa.has(p));
}

/** How well a prediction stands for a truth item; null when it cannot. */
export function pairScore(t: EvalItem, p: EvalItem): { score: number; iou: number | null; title: number } | null {
  if (!shares(t, p)) return null;
  const boxIou = t.box && p.box && t.photo === p.photo ? iou(t.box, p.box) : null;
  const title = titleSimilarity(t.title, p.title);
  const sameTrade = (t.trade || "general") === (p.trade || "general");
  const ok = (boxIou !== null && boxIou >= MATCH_IOU) || title >= MATCH_TITLE || (boxIou === null && sameTrade && title > 0);
  if (!ok) return null;
  return { score: (boxIou ?? 0) * 2 + title + (sameTrade ? 0.2 : 0), iou: boxIou, title };
}

/** One-to-one matching, best pairs first. */
export function matchItems(truth: readonly EvalItem[], preds: readonly EvalItem[]): { pairs: Pair[]; missed: number[]; extra: number[] } {
  const cands: (Pair & { score: number })[] = [];
  truth.forEach((t, ti) =>
    preds.forEach((p, pi) => {
      const s = pairScore(t, p);
      if (s) cands.push({ truth: ti, pred: pi, iou: s.iou, title: s.title, score: s.score });
    }),
  );
  cands.sort((a, b) => b.score - a.score || a.truth - b.truth || a.pred - b.pred);
  const usedT = new Set<number>();
  const usedP = new Set<number>();
  const pairs: Pair[] = [];
  for (const c of cands) {
    if (usedT.has(c.truth) || usedP.has(c.pred)) continue;
    usedT.add(c.truth);
    usedP.add(c.pred);
    pairs.push({ truth: c.truth, pred: c.pred, iou: c.iou, title: c.title });
  }
  return {
    pairs,
    missed: truth.map((_, i) => i).filter((i) => !usedT.has(i)),
    extra: preds.map((_, i) => i).filter((i) => !usedP.has(i)),
  };
}

export type CaseScore = {
  truth: number;
  predicted: number;
  tp: number;
  fp: number;
  fn: number;
  repeatedFalseAlarms: number;
  boxPairs: number;
  boxHits: number;
  severityExact: number;
  severityWithinOne: number;
  /** Per trade: truth trade for hits and misses, the prediction's for false positives. */
  byTrade: Record<string, { tp: number; fp: number; fn: number }>;
  pairs: Pair[];
  missed: number[];
  extra: number[];
};

export function scoreCase(truth: readonly TruthItem[], dismissed: readonly EvalItem[], preds: readonly EvalItem[]): CaseScore {
  const { pairs, missed, extra } = matchItems(truth, preds);
  const byTrade: CaseScore["byTrade"] = {};
  const bump = (trade: string, k: "tp" | "fp" | "fn") => {
    const key = trade || "general";
    byTrade[key] ??= { tp: 0, fp: 0, fn: 0 };
    byTrade[key][k]++;
  };
  let boxPairs = 0;
  let boxHits = 0;
  let severityExact = 0;
  let severityWithinOne = 0;
  for (const p of pairs) {
    const t = truth[p.truth];
    const pr = preds[p.pred];
    bump(t.trade, "tp");
    if (p.iou !== null) {
      boxPairs++;
      if (p.iou >= BOX_HIT_IOU) boxHits++;
    }
    const d = Math.abs(SEVERITY_ORDER[t.severity] - SEVERITY_ORDER[pr.severity]);
    if (d === 0) severityExact++;
    if (d <= 1) severityWithinOne++;
  }
  for (const i of missed) bump(truth[i].trade, "fn");
  for (const i of extra) bump(preds[i].trade, "fp");
  const repeated = matchItems(dismissed, extra.map((i) => preds[i])).pairs.length;
  return {
    truth: truth.length,
    predicted: preds.length,
    tp: pairs.length,
    fp: extra.length,
    fn: missed.length,
    repeatedFalseAlarms: repeated,
    boxPairs,
    boxHits,
    severityExact,
    severityWithinOne,
    byTrade,
    pairs,
    missed,
    extra,
  };
}

export type Totals = {
  cases: number;
  truth: number;
  predicted: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  repeatedFalseAlarms: number;
  boxHitRate: number | null;
  severityExact: number | null;
  severityWithinOne: number | null;
  byTrade: { trade: string; tp: number; fp: number; fn: number; precision: number | null; recall: number | null }[];
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function totals(cases: readonly CaseScore[]): Totals {
  const sum = (k: keyof Pick<CaseScore, "truth" | "predicted" | "tp" | "fp" | "fn" | "repeatedFalseAlarms" | "boxPairs" | "boxHits" | "severityExact" | "severityWithinOne">) =>
    cases.reduce((s, c) => s + c[k], 0);
  const tp = sum("tp");
  const fp = sum("fp");
  const fn = sum("fn");
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const trades = new Map<string, { tp: number; fp: number; fn: number }>();
  for (const c of cases)
    for (const [t, v] of Object.entries(c.byTrade)) {
      const cur = trades.get(t) ?? { tp: 0, fp: 0, fn: 0 };
      trades.set(t, { tp: cur.tp + v.tp, fp: cur.fp + v.fp, fn: cur.fn + v.fn });
    }
  return {
    cases: cases.length,
    truth: sum("truth"),
    predicted: sum("predicted"),
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    repeatedFalseAlarms: sum("repeatedFalseAlarms"),
    boxHitRate: ratio(sum("boxHits"), sum("boxPairs")),
    severityExact: ratio(sum("severityExact"), tp),
    severityWithinOne: ratio(sum("severityWithinOne"), tp),
    byTrade: [...trades.entries()]
      .map(([trade, v]) => ({ trade, ...v, precision: ratio(v.tp, v.tp + v.fp), recall: ratio(v.tp, v.tp + v.fn) }))
      .sort((a, b) => b.tp + b.fn - (a.tp + a.fn) || a.trade.localeCompare(b.trade)),
  };
}
