// The plan-page extraction worker. Runs as its own short-lived Node process
// (forked by `worker-client.ts`) because pdf.js and the canvas keep memory the
// Next process should never carry: a 34-sheet set drove one process to 2.3 GB
// in the M0 test while the heap stayed under 512 MB. This file is plain JS so
// it can be started by path at run time; it holds no business logic — it
// turns pages into positioned text, raw drawn segments and PNG renders, and
// the TypeScript beside it does all the reading.
//
//   node extract-worker.mjs '<json>'
//   { "pdf": "/abs/file.pdf", "mode": "inventory" }
//   { "pdf": "/abs/file.pdf", "mode": "pages", "outDir": "/abs/dir", "pages": [3, 4], "renders": [72, 144] }
//
// Output: one JSON object per line on stdout. Errors: a line {"error": "..."} and exit 1.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "..", "..", "..", "package.json"));

const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

async function main() {
  const args = JSON.parse(process.argv[2] || "{}");
  if (!args.pdf) throw new Error("pdf is required");
  const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
  const bytes = fs.readFileSync(args.pdf);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    if (args.mode === "inventory") {
      const sizes = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        sizes.push({ page: n, widthPt: round2(vp.width), heightPt: round2(vp.height), rotation: page.rotate });
        page.cleanup();
      }
      out({ pages: doc.numPages, sizes });
      return;
    }
    if (args.mode === "pages") {
      const { createCanvas } = require("@napi-rs/canvas");
      fs.mkdirSync(args.outDir, { recursive: true });
      const renders = Array.isArray(args.renders) ? args.renders : [72];
      for (const n of args.pages) {
        const t0 = Date.now();
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const extract = args.extract !== false;
        const text = extract ? await extractText(pdfjs, page, vp) : [];
        const geometry = extract ? await extractGeometry(pdfjs, page, vp) : { segments: [], stats: { images: 0 } };
        const base = path.join(args.outDir, `p${n}`);
        const files = { text: null, geometry: null, renders: {} };
        if (extract) {
          fs.writeFileSync(`${base}.text.json`, JSON.stringify({ pageNumber: n, widthPt: round2(vp.width), heightPt: round2(vp.height), items: text }));
          fs.writeFileSync(`${base}.geometry.json`, JSON.stringify({ pageNumber: n, widthPt: round2(vp.width), heightPt: round2(vp.height), segments: geometry.segments, stats: geometry.stats }));
          files.text = `p${n}.text.json`;
          files.geometry = `p${n}.geometry.json`;
        }
        for (const dpi of renders) {
          const scale = dpi / 72;
          const v = page.getViewport({ scale });
          const canvas = createCanvas(Math.ceil(v.width), Math.ceil(v.height));
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: v }).promise;
          const name = `p${n}.r${dpi}.png`;
          fs.writeFileSync(path.join(args.outDir, name), canvas.toBuffer("image/png"));
          files.renders[dpi] = name;
        }
        page.cleanup();
        out({ page: n, widthPt: round2(vp.width), heightPt: round2(vp.height), rotation: page.rotate, textItems: text.length, segments: geometry.segments.length, images: geometry.stats.images, files, ms: Date.now() - t0 });
      }
      out({ done: true });
      return;
    }
    throw new Error(`unknown mode ${args.mode}`);
  } finally {
    await doc.destroy();
  }
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Positioned text runs in viewport coordinates (origin top-left, y down, PDF points). */
async function extractText(pdfjs, page, vp) {
  const tc = await page.getTextContent();
  const items = [];
  let i = 0;
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [x, y] = pdfjs.Util.applyTransform([it.transform[4], it.transform[5]], vp.transform);
    const fontPx = Math.hypot(it.transform[0], it.transform[1]);
    items.push({ id: `t${i++}`, str: it.str.trim(), x: round1(x), y: round1(y), w: round1(it.width), h: round1(it.height || fontPx) });
  }
  return items;
}

/**
 * Straight segments in viewport coordinates, with the transform tracked through
 * save/restore/transform and form XObjects, curves flattened to chords. Raw:
 * duplicates and dash fragments are left for the TypeScript side to merge.
 */
async function extractGeometry(pdfjs, page, vp) {
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList();
  const segs = [];
  const stats = { ops: ops.fnArray.length, lines: 0, curves: 0, rects: 0, forms: 0, images: 0, shadings: 0 };
  let ctm = vp.transform.slice();
  const stack = [];
  let lineWidth = 1;
  const lwStack = [];
  let formDepth = 0;
  const ap = (p) => pdfjs.Util.applyTransform(p, ctm);
  const push = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ x1: round2(a[0]), y1: round2(a[1]), x2: round2(b[0]), y2: round2(b[1]), len: round2(len), lw: round2(lineWidth), form: formDepth > 0 });
  };
  const bez = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
  };
  const CHORDS = 6;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (fn === OPS.save) { stack.push(ctm.slice()); lwStack.push(lineWidth); }
    else if (fn === OPS.restore) { ctm = stack.pop() || ctm; lineWidth = lwStack.pop() ?? lineWidth; }
    else if (fn === OPS.transform) ctm = pdfjs.Util.transform(ctm, a);
    else if (fn === OPS.setLineWidth) lineWidth = a[0];
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); lwStack.push(lineWidth); if (a[0]) ctm = pdfjs.Util.transform(ctm, a[0]); formDepth++; stats.forms++; }
    else if (fn === OPS.paintFormXObjectEnd) { ctm = stack.pop() || ctm; lineWidth = lwStack.pop() ?? lineWidth; formDepth--; }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) stats.images++;
    else if (fn === OPS.shadingFill) stats.shadings++;
    else if (fn === OPS.constructPath) {
      const [pops, c] = a;
      let k = 0, cur = null, start = null;
      for (const op of pops) {
        if (op === OPS.moveTo) { cur = [c[k], c[k + 1]]; start = cur; k += 2; }
        else if (op === OPS.lineTo) { const p = [c[k], c[k + 1]]; k += 2; if (cur) { push(ap(cur), ap(p)); stats.lines++; } cur = p; }
        else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
          let p1, p2, p3;
          if (op === OPS.curveTo) { p1 = [c[k], c[k + 1]]; p2 = [c[k + 2], c[k + 3]]; p3 = [c[k + 4], c[k + 5]]; k += 6; }
          else if (op === OPS.curveTo2) { p1 = cur; p2 = [c[k], c[k + 1]]; p3 = [c[k + 2], c[k + 3]]; k += 4; }
          else { p1 = [c[k], c[k + 1]]; p2 = [c[k + 2], c[k + 3]]; p3 = p2; k += 4; }
          if (cur) { let prev = cur; for (let s = 1; s <= CHORDS; s++) { const q = bez(cur, p1, p2, p3, s / CHORDS); push(ap(prev), ap(q)); prev = q; } stats.curves++; }
          cur = p3;
        }
        else if (op === OPS.rectangle) {
          const [x, y, w, h] = [c[k], c[k + 1], c[k + 2], c[k + 3]]; k += 4;
          const q = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
          for (let j = 0; j < 4; j++) push(ap(q[j]), ap(q[(j + 1) % 4]));
          stats.rects++; cur = [x, y]; start = cur;
        }
        else if (op === OPS.closePath) { if (cur && start) push(ap(cur), ap(start)); cur = start; }
      }
    }
  }
  return { segments: segs, stats };
}

const round1 = (v) => Math.round(v * 10) / 10;

main().catch((err) => {
  out({ error: err && err.message ? err.message : String(err) });
  process.exit(1);
});
