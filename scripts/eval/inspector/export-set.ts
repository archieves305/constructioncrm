import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../../src/lib/db/prisma";
import { readFile } from "../../../src/lib/files/storage";
import { parseBoxes } from "../../../src/lib/inspector/boxes";
import type { EvalCase, EvalSet } from "./set";

/**
 * Build the inspector's evaluation set from reviewed inspections: each area
 * becomes a case — its photos, what a person confirmed (truth) and what they
 * dismissed (known false alarms). Read-only on the database.
 *
 *   npx tsx scripts/eval/inspector/export-set.ts --out ~/knu-inspector-eval/2026-12
 *   … --include-open          also open inspections (areas with nothing left to review)
 *   … --inspection INS-00007  only these (repeatable)
 *   … --since 2026-11-25      only inspections started on or after
 *
 * An area is left out while any of its findings is still PROPOSED, or when it
 * has no photo. `--out` must be outside the repository: the set holds real job
 * photos. On the droplet, run as `knuco` with /etc/knuco/env loaded, then copy
 * the folder to the Mac with scp.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const outArg = arg("--out");
const includeOpen = process.argv.includes("--include-open");
const since = arg("--since");
const only = process.argv.flatMap((a, i) => (process.argv[i - 1] === "--inspection" ? [a] : []));

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function main() {
  if (!outArg) throw new Error("Give --out <folder outside the repository>");
  const out = path.resolve(outArg.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const repo = path.resolve(__dirname, "../../..");
  if (out === repo || out.startsWith(repo + path.sep)) throw new Error(`--out is inside the repository (${repo}); the set holds job photos and must stay out of git`);

  const inspections = await prisma.qualityInspection.findMany({
    where: {
      ...(includeOpen ? {} : { status: { in: ["ACCEPTED", "CLOSED"] } }),
      ...(only.length ? { number: { in: only } } : {}),
      ...(since ? { createdAt: { gte: new Date(`${since}T00:00:00Z`) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      number: true,
      kind: true,
      qualityProfile: true,
      scopeText: true,
      areas: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, trade: true } },
      photos: { orderBy: { createdAt: "asc" }, select: { id: true, areaId: true, width: true, height: true, file: { select: { storageKey: true, fileType: true } } } },
      findings: { select: { areaId: true, photoId: true, relatedPhotoIds: true, title: true, severity: true, trade: true, boxes: true, review: true, source: true, dismissReason: true } },
    },
  });

  const cases: EvalCase[] = [];
  const skipped: string[] = [];
  for (const insp of inspections) {
    const areas: { id: string | null; name: string; trade: string | null }[] = [...insp.areas];
    if (insp.photos.some((p) => !p.areaId)) areas.push({ id: null, name: "General", trade: null });
    for (const [ai, area] of areas.entries()) {
      const caseId = `${insp.number}-${ai + 1}`;
      const photos = insp.photos.filter((p) => p.areaId === area.id && EXT[p.file.fileType]);
      const findings = insp.findings.filter((f) => f.areaId === area.id);
      if (!photos.length) continue;
      if (findings.some((f) => f.review === "PROPOSED")) {
        skipped.push(`${caseId} (${area.name}): findings still to review`);
        continue;
      }
      const keyOf = new Map<string, string>();
      const casePhotos: EvalCase["photos"] = [];
      for (const [i, p] of photos.entries()) {
        const key = `p${i + 1}`;
        const file = `photos/${caseId}/${key}.${EXT[p.file.fileType]}`;
        try {
          const bytes = await readFile(p.file.storageKey);
          await fs.mkdir(path.join(out, path.dirname(file)), { recursive: true });
          await fs.writeFile(path.join(out, file), bytes);
        } catch {
          skipped.push(`${caseId}: photo ${key} missing on disk`);
          continue;
        }
        keyOf.set(p.id, key);
        casePhotos.push({ key, file, mediaType: p.file.fileType as EvalCase["photos"][number]["mediaType"], width: p.width, height: p.height });
      }
      if (!casePhotos.length) continue;
      const item = (f: (typeof findings)[number]) => {
        const photo = f.photoId ? keyOf.get(f.photoId) : undefined;
        if (!photo) return null;
        const also = (Array.isArray(f.relatedPhotoIds) ? (f.relatedPhotoIds as string[]) : []).map((id) => keyOf.get(id)).filter((k): k is string => !!k && k !== photo);
        return { photo, also, title: f.title, severity: f.severity, trade: f.trade ?? "general", box: parseBoxes(f.boxes)[0] ?? null };
      };
      const truth: EvalCase["truth"] = [];
      const dismissed: EvalCase["dismissed"] = [];
      let unplaced = 0;
      for (const f of findings) {
        const it = item(f);
        if (f.review === "CONFIRMED") {
          if (it) truth.push({ ...it, source: f.source === "PERSON" ? "PERSON" : "AI" });
          else unplaced++;
        } else if (f.review === "DISMISSED" && it) dismissed.push({ ...it, reason: f.dismissReason });
      }
      cases.push({
        id: caseId,
        inspection: insp.number,
        kind: insp.kind,
        profile: insp.qualityProfile,
        area: area.name,
        trade: area.trade,
        scopeText: insp.scopeText,
        otherAreas: areas.filter((a) => a.id !== area.id).map((a) => a.name),
        photos: casePhotos,
        truth,
        dismissed,
        unplaced,
      });
    }
  }

  const set: EvalSet = { name: path.basename(out), exportedAt: new Date().toISOString(), source: process.env.APP_BASE_URL ?? "unknown", cases };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, "set.json"), JSON.stringify(set, null, 2));

  const photos = cases.reduce((s, c) => s + c.photos.length, 0);
  const truth = cases.reduce((s, c) => s + c.truth.length, 0);
  const person = cases.reduce((s, c) => s + c.truth.filter((t) => t.source === "PERSON").length, 0);
  const dism = cases.reduce((s, c) => s + c.dismissed.length, 0);
  console.log(`Set written to ${out}`);
  console.log(`  ${inspections.length} inspections → ${cases.length} areas, ${photos} photos`);
  console.log(`  truth: ${truth} confirmed (${person} added by a person — the AI missed them), ${dism} dismissed`);
  if (skipped.length) console.log(`  left out:\n    ${skipped.join("\n    ")}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
