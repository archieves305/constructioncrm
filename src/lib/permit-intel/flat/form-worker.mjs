// The flat-form page worker. Runs as its own short-lived Node process
// (started by `form-worker-client.ts`) so pdf.js and the canvas never sit in
// the Next process, as the takeoff's extraction worker does. Plain JS, no
// business logic: it renders pages and draws numbered boxes; the TypeScript
// beside it finds the blanks.
//
//   node form-worker.mjs '{"mode":"render","pdf":"/abs/f.pdf","outDir":"/abs/d","dpi":150,"maxPages":12}'
//     → per page {"page":1,"width":1275,"height":1650,"widthPt":612,"heightPt":792,"png":"p1.png","gray":"p1.gray"}
//   node form-worker.mjs '{"mode":"mark","png":"/abs/p1.png","out":"/abs/p1.marked.png","boxes":[{"id":1,"x":10,"y":20,"w":100,"h":20}]}'
//     → {"marked":"/abs/p1.marked.png"}
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
  const { createCanvas, loadImage } = require("@napi-rs/canvas");

  if (args.mode === "render") {
    const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
    // the standard 14 fonts (Helvetica…) are not embedded in many forms: pdf.js draws them from its own copies
    const standardFontDataUrl = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(args.pdf)), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl }).promise;
    try {
      fs.mkdirSync(args.outDir, { recursive: true });
      const dpi = args.dpi || 150;
      const last = Math.min(doc.numPages, args.maxPages || 12);
      for (let n = 1; n <= last; n++) {
        const page = await doc.getPage(n);
        const pt = page.getViewport({ scale: 1 });
        const v = page.getViewport({ scale: dpi / 72 });
        const w = Math.ceil(v.width);
        const h = Math.ceil(v.height);
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        await page.render({ canvasContext: ctx, viewport: v }).promise;
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const gray = Buffer.alloc(w * h);
        for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
        fs.writeFileSync(path.join(args.outDir, `p${n}.png`), canvas.toBuffer("image/png"));
        fs.writeFileSync(path.join(args.outDir, `p${n}.gray`), gray);
        out({ page: n, width: w, height: h, widthPt: pt.width, heightPt: pt.height, png: `p${n}.png`, gray: `p${n}.gray` });
        page.cleanup();
      }
      out({ done: true, pages: doc.numPages });
    } finally {
      await doc.destroy();
    }
    return;
  }

  if (args.mode === "mark") {
    const img = await loadImage(fs.readFileSync(args.png));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    ctx.font = "bold 15px sans-serif";
    for (const b of args.boxes) {
      ctx.strokeStyle = b.kind === "box" ? "#0057d9" : "#d6001c";
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const label = String(b.id);
      const tw = ctx.measureText(label).width + 6;
      const lx = Math.max(0, b.x - (b.kind === "box" ? tw + 2 : 0));
      const ly = b.kind === "box" ? b.y : Math.max(0, b.y - 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(lx, ly, tw, 17);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, lx + 3, ly + 13);
    }
    fs.writeFileSync(args.out, canvas.toBuffer("image/png"));
    out({ marked: args.out });
    return;
  }
  throw new Error(`unknown mode ${args.mode}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    out({ error: err && err.message ? err.message : String(err) });
    process.exit(1);
  },
);
