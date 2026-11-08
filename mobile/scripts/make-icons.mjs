// KNU Field lettermark icons, drawn with @napi-rs/canvas (already a CRM dependency).
// Steel-blue (#2B5F94, the app's brand) with a white roof line over "KNU".
// Run from the CRM repo root (it has @napi-rs/canvas): node mobile/scripts/make-icons.mjs mobile/assets
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
GlobalFonts.registerFromPath("/System/Library/Fonts/Supplemental/Arial Black.ttf", "ArialBlack");
const BRAND = "#2B5F94";
const DEEP = "#1E4670";

/** The mark: a roof line and KNU, centred in a square of `size`, drawn in `fg`. */
function mark(ctx, size, fg, scale = 1) {
  const c = size / 2;
  const s = size * scale;
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.lineWidth = s * 0.055;
  ctx.lineJoin = "miter";
  ctx.lineCap = "square";
  // roof
  ctx.beginPath();
  ctx.moveTo(c - s * 0.3, c - s * 0.06);
  ctx.lineTo(c, c - s * 0.3);
  ctx.lineTo(c + s * 0.3, c - s * 0.06);
  ctx.stroke();
  // chimney
  ctx.fillRect(c + s * 0.14, c - s * 0.27, s * 0.055, s * 0.11);
  // KNU
  ctx.font = `${Math.round(s * 0.25)}px ArialBlack`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("KNU", c, c + s * 0.22);
}

function save(name, size, draw) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  fs.writeFileSync(path.join(out, name), canvas.toBuffer("image/png"));
}

// iOS / store icon: full-bleed, no transparency (iOS rounds the corners itself).
save("icon.png", 1024, (ctx, n) => {
  const g = ctx.createLinearGradient(0, 0, 0, n);
  g.addColorStop(0, BRAND);
  g.addColorStop(1, DEEP);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  mark(ctx, n, "#FFFFFF");
});
// Android adaptive icon: the mark inside the 66 % safe zone on transparency, plus background and monochrome.
save("android-icon-foreground.png", 1024, (ctx, n) => mark(ctx, n, "#FFFFFF", 0.62));
save("android-icon-background.png", 1024, (ctx, n) => {
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, n, n);
});
save("android-icon-monochrome.png", 1024, (ctx, n) => mark(ctx, n, "#FFFFFF", 0.62));
// Splash: the mark in brand blue on transparency (shown on the splash background).
save("splash-icon.png", 1024, (ctx, n) => mark(ctx, n, BRAND, 0.9));
save("favicon.png", 48, (ctx, n) => {
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, n, n);
  mark(ctx, n, "#FFFFFF");
});
console.log("written to", out);
// Dark-mode splash: the app's dark-theme brand blue, readable on near-black.
save("splash-icon-dark.png", 1024, (ctx, n) => mark(ctx, n, "#7FA9DB", 0.9));
