// Shared harness for the browser regression suite (scripts/qa). Dev only:
// every entry point calls assertLocalDatabase() first, and the suite talks to a
// dev server started with the CareyOS dev sign-in bypass (see run.sh).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const BASE = process.env.QA_BASE_URL ?? "http://localhost:4000";
export const OUT = process.env.QA_OUT ?? path.join(ROOT, "qa-out");
fs.mkdirSync(OUT, { recursive: true });

const DEFAULT_SHELL = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
/** Headless shell by default; QA_CHROMIUM points at a full Chromium (needed for PDF frames). */
export const CHROMIUM = process.env.QA_CHROMIUM ?? DEFAULT_SHELL;

/** DATABASE_URL from the environment, else from .env (no other variables are read). */
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.existsSync(path.join(ROOT, ".env")) ? fs.readFileSync(path.join(ROOT, ".env"), "utf8") : "";
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error("DATABASE_URL is not set and not in .env");
  return m[1];
}

/** psql wants no Prisma `?schema=` parameter. */
export const psqlUrl = () => databaseUrl().replace(/\?.*$/, "");

/** Refuse to run against anything but a database on this machine. */
export function assertLocalDatabase() {
  const host = new URL(databaseUrl().replace(/^postgres(ql)?:/, "http:")).hostname;
  if (!["localhost", "127.0.0.1", "::1", ""].includes(host)) {
    console.error(`qa: refusing to run — DATABASE_URL points at ${host}, not this machine`);
    process.exit(2);
  }
  const base = new URL(BASE).hostname;
  if (!["localhost", "127.0.0.1"].includes(base)) {
    console.error(`qa: refusing to run — QA_BASE_URL is ${base}, not this machine`);
    process.exit(2);
  }
}

/** One value from the dev database (read-only helper; writes go through the app). */
export function sql(query) {
  return execFileSync("psql", [psqlUrl(), "-Atc", query], { encoding: "utf8" }).trim();
}

export async function launch() {
  return chromium.launch({ executablePath: CHROMIUM });
}

/** A signed-in context: the dev bypass accepts any `careyos_session` cookie. */
export async function newContext(browser, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: "careyos_session", value: "dev", domain: host, path: "/" }]);
  return ctx;
}

/** Wait until the dev server answers (it compiles on first request). */
export async function waitForServer(timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/me`, { headers: { cookie: "careyos_session=dev" } });
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`dev server at ${BASE} did not answer in ${timeoutMs / 1000} s`);
}

/**
 * Step recorder: each step returns true / a note string (pass) or false / throws (fail).
 * Results go to qa-out/<name>.json; the process exits 1 when any step failed.
 */
export function recorder(name) {
  const results = [];
  let group = "";
  return {
    results,
    set group(g) { group = g; },
    async step(label, fn) {
      const r = { group, step: label };
      try {
        const v = await fn();
        r.ok = v !== false;
        if (typeof v === "string") r.note = v;
      } catch (e) {
        r.ok = false;
        r.error = String(e?.message ?? e).split("\n")[0].slice(0, 240);
      }
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"} ${group ? `[${group}] ` : ""}${label}${r.note ? ` — ${r.note}` : ""}${r.error ? ` — ${r.error}` : ""}`);
      return r.ok;
    },
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(results, null, 2));
      console.log(`${name}: ${results.length - failed}/${results.length} passed → ${path.relative(ROOT, path.join(OUT, `${name}.json`))}`);
      return failed;
    },
  };
}

/** `expect(cond, message)` for use inside a step. */
export function expect(cond, message) {
  if (!cond) throw new Error(message);
}

/** JSON API call through the page's cookies. */
export function apiFor(page) {
  return async (method, url, body) => {
    const r = await page.request.fetch(BASE + url, { method, data: body, headers: { "content-type": "application/json" } });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status(), body: json };
  };
}

/** Shared state between flows.mjs (writes) and roles.mjs (reads). */
export const statePath = path.join(OUT, "state.json");
export const readState = () => (fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {});
export const writeState = (s) => fs.writeFileSync(statePath, JSON.stringify(s, null, 2));

/** A one-page PDF, written once, for upload steps. */
export function samplePdf() {
  const file = path.join(OUT, "QA sample.pdf");
  if (!fs.existsSync(file)) {
    const body = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
    fs.writeFileSync(file, body);
  }
  return file;
}
