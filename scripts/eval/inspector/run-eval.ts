import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../../src/lib/db/prisma";
import { runAiCall } from "../../../src/lib/ai/calls";
import { tierFor } from "../../../src/lib/inspector/boxes";
import { isQualityProfile, type InspectionKind } from "../../../src/lib/inspector/catalog";
import { scoreCase, totals, type CaseScore, type EvalItem, type Totals } from "../../../src/lib/inspector/eval";
import * as area from "../../../src/lib/inspector/prompt";
import { BATCH } from "../../../src/lib/inspector/analyze";
import { planAnswer, type KnownFinding } from "../../../src/lib/inspector/state";
import { setSchema, type EvalCase } from "./set";

/**
 * Run models over the evaluation set and score them against the people's
 * review. Same prompt, batching and answer handling as the live inspector
 * (`analyze.ts`): photos in batches of six, later batches told what earlier
 * ones found, repeats folded by `planAnswer`.
 *
 *   npx tsx scripts/eval/inspector/run-eval.ts --set ~/knu-inspector-eval/2026-12            # plan only: cases, photos, rough cost
 *   npx tsx scripts/eval/inspector/run-eval.ts --set … --yes                                  # run (default: Sonnet 5.5 and Opus 5.5)
 *   … --models claude-sonnet-5-5   … --effort high   … --limit 10 (first n cases)
 *
 * Every call goes through `runAiCall` (subject type `inspection_eval`, one
 * subject per case), so it is recorded in the database the script points at,
 * held to its caps, and a re-run of the same model on the same photos is free.
 * Results go to `<set>/results/<time>/` (results.json + report.md).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const setArg = arg("--set");
const models = (arg("--models") ?? "claude-sonnet-5-5,claude-opus-5-5").split(",").map((m) => m.trim()).filter(Boolean);
const effort = (arg("--effort") ?? "medium") as "low" | "medium" | "high";
const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
const yes = process.argv.includes("--yes");

/** Rough planning numbers per photo (dev QA 2026-11-25: Sonnet ≈ 1.7¢). */
const ROUGH_USD_PER_PHOTO: Record<string, number> = { "claude-sonnet-5-5": 0.017, "claude-opus-5-5": 0.03 };

type ModelRun = {
  model: string;
  totals: Totals;
  costUsd: number;
  calls: number;
  cachedCalls: number;
  failedCalls: number;
  secondsPerPhoto: number | null;
  cases: { id: string; area: string; score: Omit<CaseScore, "pairs" | "missed" | "extra">; predictions: EvalItem[]; missed: string[]; falseAlarms: string[]; error?: string }[];
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

async function runCase(dir: string, setName: string, c: EvalCase, model: string) {
  const preds: EvalItem[] = [];
  const known: KnownFinding[] = [];
  let costUsd = 0;
  let ms = 0;
  let calls = 0;
  let cached = 0;
  for (let start = 0; start < c.photos.length; start += BATCH) {
    const chunk = c.photos.slice(start, start + BATCH);
    const inputs: area.PhotoInput[] = [];
    const answerPhotos: { n: number; id: string; width: number; height: number }[] = [];
    const hashes: string[] = [];
    for (const p of chunk) {
      const bytes = await fs.readFile(path.join(dir, p.file));
      hashes.push(createHash("sha256").update(bytes).digest("hex"));
      const n = inputs.length + 1;
      inputs.push({ n, base64: bytes.toString("base64"), mediaType: p.mediaType, width: p.width, height: p.height });
      answerPhotos.push({ n, id: p.key, width: p.width, height: p.height });
    }
    const ctx: area.AreaContext = {
      kind: c.kind as InspectionKind,
      profile: isQualityProfile(c.profile) ? c.profile : "standard",
      area: c.area,
      trade: c.trade,
      scopeText: c.scopeText,
      known: known.map((k) => k.title),
      otherAreas: c.otherAreas,
    };
    const result = await runAiCall({
      subjectType: "inspection_eval",
      subjectId: `${setName}:${c.id}`,
      purpose: area.PURPOSE,
      promptVersion: area.PROMPT_VERSION,
      schema: area.schema,
      inputs: { photos: hashes, ctx },
      system: area.SYSTEM,
      content: area.content(ctx, inputs),
      model,
      effort,
      maxTokens: 12_000,
    });
    calls++;
    if (result.cached) cached++;
    costUsd += result.costUsd;
    ms += result.durationMs;
    const plan = planAnswer(result.output, answerPhotos, tierFor(result.model), known);
    for (const f of plan.findings) {
      preds.push({ photo: f.photoId, also: f.relatedPhotoIds, title: f.title, severity: f.severity, trade: f.trade, box: f.boxes[0] ?? null });
      known.push({ id: `k${known.length}`, trade: f.trade, title: f.title, photoIds: [f.photoId, ...f.relatedPhotoIds], boxes: f.boxes, boxPhotoId: f.photoId });
    }
    for (const r of plan.repeats) {
      const k = known.find((x) => x.id === r.findingId);
      const p = k ? preds[known.indexOf(k)] : undefined;
      if (p) p.also = [...new Set([...(p.also ?? []), ...r.photoIds])].filter((x) => x !== p.photo);
    }
  }
  return { preds, costUsd, ms, calls, cached };
}

function report(setName: string, runs: ModelRun[], photos: number): string {
  const lines: string[] = [`# Inspector evaluation — ${setName}`, "", `${runs[0]?.totals.cases ?? 0} areas, ${photos} photos, effort ${effort}. Truth = what a person confirmed (AI findings kept + findings the person added); dismissed findings are known false alarms.`, ""];
  lines.push("| Model | Precision | Recall | F1 | Found / real | False alarms (repeated) | Box hit (IoU ≥ 0.3) | Severity exact / ±1 | Cost | s / photo |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of runs) {
    const t = r.totals;
    lines.push(`| ${r.model} | ${pct(t.precision)} | ${pct(t.recall)} | ${pct(t.f1)} | ${t.tp} / ${t.truth} | ${t.fp} (${t.repeatedFalseAlarms}) | ${pct(t.boxHitRate)} | ${pct(t.severityExact)} / ${pct(t.severityWithinOne)} | $${r.costUsd.toFixed(2)}${r.cachedCalls ? ` (${r.cachedCalls} cached)` : ""} | ${r.secondsPerPhoto?.toFixed(1) ?? "—"} |`);
  }
  for (const r of runs) {
    lines.push("", `## ${r.model} by trade`, "", "| Trade | Found | Missed | False alarms | Precision | Recall |", "|---|---|---|---|---|---|");
    for (const t of r.totals.byTrade) lines.push(`| ${t.trade} | ${t.tp} | ${t.fn} | ${t.fp} | ${pct(t.precision)} | ${pct(t.recall)} |`);
    const missed = r.cases.flatMap((c) => c.missed.map((m) => `${c.id} ${c.area}: ${m}`));
    const extra = r.cases.flatMap((c) => c.falseAlarms.map((m) => `${c.id} ${c.area}: ${m}`));
    const failed = r.cases.filter((c) => c.error).map((c) => `${c.id}: ${c.error}`);
    if (missed.length) lines.push("", "Missed:", ...missed.map((m) => `- ${m}`));
    if (extra.length) lines.push("", "False alarms:", ...extra.map((m) => `- ${m}`));
    if (failed.length) lines.push("", "Calls that failed (left out of the scores):", ...failed.map((m) => `- ${m}`));
  }
  lines.push("", "Small sets move these numbers a lot: read them with the counts beside them.");
  return lines.join("\n");
}

async function main() {
  if (!setArg) throw new Error("Give --set <folder with set.json>");
  const dir = path.resolve(setArg.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const set = setSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "set.json"), "utf8")));
  const cases = set.cases.slice(0, limit ?? set.cases.length);
  const photos = cases.reduce((s, c) => s + c.photos.length, 0);
  const truth = cases.reduce((s, c) => s + c.truth.length, 0);
  console.log(`Set ${set.name}: ${cases.length} areas, ${photos} photos, ${truth} confirmed findings`);
  for (const m of models) console.log(`  ${m}: about $${((ROUGH_USD_PER_PHOTO[m] ?? 0.03) * photos).toFixed(2)} if nothing is cached`);
  if (!yes) {
    console.log("Plan only. Add --yes to run.");
    return;
  }

  const runs: ModelRun[] = [];
  for (const model of models) {
    const run: ModelRun = { model, totals: totals([]), costUsd: 0, calls: 0, cachedCalls: 0, failedCalls: 0, secondsPerPhoto: null, cases: [] };
    const scores: CaseScore[] = [];
    let ms = 0;
    let freshPhotos = 0;
    for (const c of cases) {
      process.stdout.write(`  ${model} ${c.id} (${c.photos.length} photos)… `);
      try {
        const r = await runCase(dir, set.name, c, model);
        const s = scoreCase(c.truth, c.dismissed, r.preds);
        scores.push(s);
        run.costUsd += r.costUsd;
        run.calls += r.calls;
        run.cachedCalls += r.cached;
        if (r.cached < r.calls) {
          ms += r.ms;
          freshPhotos += c.photos.length;
        }
        const { pairs: _p, missed, extra, ...rest } = s;
        void _p;
        run.cases.push({ id: c.id, area: c.area, score: rest, predictions: r.preds, missed: missed.map((i) => c.truth[i].title), falseAlarms: extra.map((i) => r.preds[i].title) });
        console.log(`found ${s.tp}/${s.truth}, ${s.fp} false alarm${s.fp === 1 ? "" : "s"}, $${r.costUsd.toFixed(3)}`);
      } catch (err) {
        run.failedCalls++;
        const message = err instanceof Error ? err.message : String(err);
        run.cases.push({ id: c.id, area: c.area, score: { truth: c.truth.length, predicted: 0, tp: 0, fp: 0, fn: 0, repeatedFalseAlarms: 0, boxPairs: 0, boxHits: 0, severityExact: 0, severityWithinOne: 0, byTrade: {} }, predictions: [], missed: [], falseAlarms: [], error: message });
        console.log(`FAILED: ${message}`);
      }
    }
    run.totals = totals(scores);
    run.secondsPerPhoto = freshPhotos ? ms / 1000 / freshPhotos : null;
    runs.push(run);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(dir, "results", stamp);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "results.json"), JSON.stringify({ set: set.name, effort, runs }, null, 2));
  const md = report(set.name, runs, photos);
  await fs.writeFile(path.join(outDir, "report.md"), md);
  console.log(`\n${md}\n\nWritten to ${outDir}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
