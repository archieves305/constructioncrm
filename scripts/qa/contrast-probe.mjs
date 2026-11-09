// Every colour-contrast failure on the axe pages, with colours and the element (diagnostic; not part of run.sh).
import fs from "node:fs";
import { createRequire } from "node:module";
import { BASE, launch, newContext, waitForServer } from "./lib.mjs";
import { resolveIds } from "./pages.mjs";
await waitForServer();
const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const ids = resolveIds();
const urls = process.argv.length > 2 ? process.argv.slice(2) : ["/", "/tasks", "/calendar", "/jobs", ids["/jobs/[id]"], "/leads", ids["/leads/[id]"], "/leads/new", "/permits", ids["/permits/[id]"], "/partners", "/violations/list", "/vendors", "/notifications", "/settings/notifications", "/reports", "/attention/overdue-tasks", ids["/g/[token]"], "/crew-submissions", "/canvassing/properties"].filter(Boolean);
const browser = await launch();
const tally = {};
for (const url of urls) {
  const ctx = await newContext(browser); const page = await ctx.newPage();
  await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 }); await page.waitForTimeout(800);
  await page.addScriptTag({ content: axeSrc });
  const nodes = await page.evaluate(async () => (await axe.run(document, { runOnly: ["color-contrast"] })).violations.flatMap((v) => v.nodes.map((n) => ({ t: n.target.join(" "), d: n.any[0]?.data, h: n.html.slice(0, 140) }))));
  for (const n of nodes) { const k = `${n.d?.fgColor} on ${n.d?.bgColor} @${n.d?.fontSize}`; (tally[k] ||= []).push(`${url} | ${n.h}`); }
  await ctx.close();
}
await browser.close();
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].length - a[1].length)) { console.log(`${v.length}× ${k}`); for (const x of v.slice(0, 3)) console.log(`     ${x}`); }
