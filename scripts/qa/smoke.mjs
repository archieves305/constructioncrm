// Smoke pass: every page at 1440 and 400 px as the role the dev server runs as.
// usage: node scripts/qa/smoke.mjs [urlRegex]
// Fails on: a page error, an error screen, a 5xx, sideways scroll at 400 px,
// a skeleton still showing after the page settled, or a 403 on a page the
// role's own sidebar offers (the nav must follow the API's role lists).
// Screenshots in qa-out/shots/<role>/.
import fs from "node:fs";
import path from "node:path";
import { assertLocalDatabase, BASE, launch, newContext, OUT, recorder, waitForServer } from "./lib.mjs";
import { pagesWithUrls } from "./pages.mjs";

assertLocalDatabase();
const me = await waitForServer();
const role = me?.role ?? me?.user?.role ?? "unknown";
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const shots = path.join(OUT, "shots", role);
fs.mkdirSync(shots, { recursive: true });
const ERROR_TEXT = /something went wrong|application error|unhandled runtime error|internal server error|cannot read properties/i;

const rec = recorder(`smoke-${role}${only ? "-partial" : ""}`);
const browser = await launch();

// The pages this role is offered: every sidebar link, read from the app itself.
const offered = await (async () => {
  const ctx = await newContext(browser, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
    const hrefs = await page.$$eval("aside a[href]", (as) => as.map((a) => new URL(a.href).pathname));
    return new Set(hrefs);
  } finally {
    await ctx.close();
  }
})();
console.log(`smoke: ${role} is offered ${offered.size} sidebar pages`);
for (const p of pagesWithUrls()) {
  if (only && !only.test(p.url)) continue;
  for (const width of [1440, 400]) {
    rec.group = `${width}`;
    await rec.step(p.url, async () => {
      if (!p.target) return "skipped: no url rule for this dynamic page (add one in pages.mjs)";
      const ctx = await newContext(browser, { width, height: width === 400 ? 860 : 900 });
      const page = await ctx.newPage();
      const pageErrors = [];
      const serverErrors = [];
      const refusals = [];
      page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
      page.on("response", (res) => {
        const u = res.url();
        if (u.startsWith(BASE) && res.status() >= 500) serverErrors.push(`${res.status()} ${res.request().method()} ${u.slice(BASE.length, BASE.length + 120)}`);
        if (u.startsWith(BASE + "/api/") && res.status() === 403) refusals.push(`403 ${res.request().method()} ${u.slice(BASE.length, BASE.length + 120)}`);
      });
      try {
        await page.goto(BASE + p.target, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(1500);
        const info = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          skeletons: document.querySelectorAll("[data-slot=skeleton]").length,
          text: document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
        }));
        const name = `${p.url.replace(/[^a-z0-9]+/gi, "_") || "root"}-${width}.png`;
        await page.screenshot({ path: path.join(shots, name), fullPage: width === 1440, timeout: 30000 }).catch(() => {});
        const problems = [];
        if (pageErrors.length) problems.push(`page error: ${pageErrors[0]}`);
        if (serverErrors.length) problems.push(serverErrors[0]);
        const err = info.text.match(ERROR_TEXT);
        if (err) problems.push(`error screen: "${err[0]}"`);
        if (width === 400 && info.overflow) problems.push(`sideways scroll (${info.scrollWidth} px)`);
        if (info.skeletons > 0) problems.push(`${info.skeletons} skeleton(s) still showing`);
        const isOffered = offered.has(p.target.split("?")[0]);
        if (refusals.length && isOffered) problems.push(`offered in the sidebar but refused: ${refusals[0]}`);
        if (problems.length) throw new Error(problems.join("; "));
        return refusals.length ? `not offered; refused (${refusals[0]})` : true;
      } finally {
        await ctx.close();
      }
    });
  }
}
await browser.close();
process.exit(rec.finish() ? 1 : 0);
