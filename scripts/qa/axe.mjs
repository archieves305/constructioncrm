// Accessibility pass: axe-core (WCAG 2.0–2.2 A / AA tags) on the key pages at 1440 px.
// usage: node scripts/qa/axe.mjs [url ...]   (default: the audit's 20 pages)
// Critical / serious violations fail the run only with QA_AXE_STRICT=1 (the Phase B gate);
// until then they are reported as "SERIOUS: …" so the run shows the trend without blocking.
import fs from "node:fs";
import { createRequire } from "node:module";
import { assertLocalDatabase, BASE, launch, newContext, readState, recorder, waitForServer } from "./lib.mjs";
import { resolveIds } from "./pages.mjs";

assertLocalDatabase();
await waitForServer();
const require = createRequire(import.meta.url);
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const ids = resolveIds();
const st = readState();
const KEY_PAGES = [
  "/", "/tasks", "/calendar", "/jobs", ids["/jobs/[id]"], "/leads", ids["/leads/[id]"], "/leads/new",
  "/permits", st.permitId ? `/permits/${st.permitId}` : ids["/permits/[id]"], "/partners", "/violations/list", "/vendors",
  "/notifications", "/settings/notifications", "/reports", "/attention/overdue-tasks", ids["/g/[token]"],
  "/crew-submissions", "/canvassing/properties",
];
const urls = process.argv.length > 2 ? process.argv.slice(2) : KEY_PAGES;
// Raise this list only on purpose: a page listed here may carry serious findings until its ticket lands.
const BLOCKING = new Set(["critical", "serious"]);

const rec = recorder(process.argv.length > 2 ? "axe-partial" : "axe");
const browser = await launch();
for (const url of urls) {
  await rec.step(url, async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(1000);
      await page.addScriptTag({ content: axeSrc });
      const violations = await page.evaluate(async () => {
        const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(" ") }));
      });
      const blocking = violations.filter((v) => BLOCKING.has(v.impact));
      const summary = violations.map((v) => `${v.id}(${v.impact}×${v.nodes})`).join(", ") || "clean";
      if (blocking.length && process.env.QA_AXE_STRICT === "1") throw new Error(summary);
      return blocking.length ? `SERIOUS: ${summary}` : summary;
    } finally {
      await ctx.close();
    }
  });
}
await browser.close();
process.exit(rec.finish() ? 1 : 0);
