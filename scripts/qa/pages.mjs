// Every page under src/app (route groups dropped), with a real url for the
// dynamic ones: an id read from the dev database, or a made-up id / token so
// the page's not-found state is what gets checked.
import fs from "node:fs";
import path from "node:path";
import { ROOT, sql } from "./lib.mjs";

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "api") walk(p, acc); }
    else if (e.name === "page.tsx") acc.push(p);
  }
  return acc;
}

export function listPages() {
  const app = path.join(ROOT, "src/app");
  return walk(app)
    .map((file) => {
      const rel = path.relative(app, path.dirname(file));
      const url = "/" + rel.split(path.sep).filter((seg) => seg && !/^\(.*\)$/.test(seg)).join("/");
      return { url: url === "/" ? "/" : url.replace(/\/$/, ""), file: path.relative(ROOT, file), dynamic: url.includes("[") };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}

const MISSING = "qa-missing-id";
const TOKEN = "qa-not-a-real-token";
const first = (q) => { try { return sql(q).split("\n")[0] || null; } catch { return null; } };
const today = new Date().toISOString().slice(0, 10);

/** One query per kind of record, so a fresh dev database still resolves what it has. */
export function resolveIds() {
  const job = first("select id from jobs order by created_at limit 1");
  const lead = first("select id from leads order by created_at limit 1");
  const pick = (q) => first(q) ?? MISSING;
  return {
    "/action/[token]": `/action/${TOKEN}`,
    "/co/[token]": `/co/${TOKEN}`,
    "/g/[token]": `/g/${TOKEN}`,
    "/sign/[token]": `/sign/${TOKEN}`,
    "/admin/contract-templates/[id]": `/admin/contract-templates/${pick("select id from contract_templates limit 1")}`,
    "/admin/permits/forms/[id]": `/admin/permits/forms/${pick("select id from permit_form_templates limit 1")}`,
    "/admin/workflow-templates/[id]": `/admin/workflow-templates/${pick("select id from workflow_templates limit 1")}`,
    "/attention/[key]": "/attention/overdue-tasks",
    "/canvassing/[id]": `/canvassing/${pick("select id from door_knock_routes limit 1")}`,
    "/field/jobs/[jobId]/daily/[date]": `/field/jobs/${job ?? MISSING}/daily/${today}`,
    "/field/jobs/[jobId]/logs": `/field/jobs/${job ?? MISSING}/logs`,
    "/field/tasks/[taskId]": `/field/tasks/${pick("select id from tasks where job_id is not null order by created_at limit 1")}`,
    "/jobs/[id]": `/jobs/${job ?? MISSING}`,
    "/jobs/[id]/daily-logs/[date]": `/jobs/${job ?? MISSING}/daily-logs/${today}`,
    "/leads/[id]": `/leads/${lead ?? MISSING}`,
    "/leads/[id]/edit": `/leads/${lead ?? MISSING}/edit`,
    "/partners/[id]": `/partners/${pick("select id from organizations limit 1")}`,
    "/permits/[id]": `/permits/${pick("select id from job_permits limit 1")}`,
    "/permits/products/[id]": `/permits/products/${pick("select id from product_approvals limit 1")}`,
    "/personnel/[id]": `/personnel/${pick("select id from personnel limit 1")}`,
    "/plans/[planSetId]": `/plans/${pick("select id from plan_sets limit 1")}`,
    "/takeoff/[takeoffId]": `/takeoff/${pick("select id from takeoffs limit 1")}`,
    "/violations/[id]": `/violations/${pick("select id from code_violation_cases limit 1")}`,
    "/vendors/[id]": `/vendors/${pick("select id from vendors limit 1")}`,
  };
}

/** Pages with a url to visit; a dynamic page with no rule is reported, not guessed. */
export function pagesWithUrls() {
  const ids = resolveIds();
  return listPages().map((p) => ({ ...p, target: p.dynamic ? ids[p.url] ?? null : p.url }));
}
