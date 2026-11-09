#!/usr/bin/env node
// T-16 check: does every office page show the shared PageHeader (or, on a
// record, the EntityHeader)? A page counts when it, or a component it imports
// from src/ (followed two levels), renders one. Pages that keep their own
// header on purpose are listed apart, each with its reason, never counted as
// passing. Exit 1 when an office page has neither.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "../..");
const SRC = join(ROOT, "src");
const HEADER = /<(PageHeader|EntityHeader)\b/;

const OWN_HEADER = [
  [/\/\(public\)\//, "public page for customers and crews: its own branded header"],
  [/\/\(auth\)\//, "sign-in bounce: no page of its own"],
  [/\/\(field\)\//, "field mode: the phone shell's compact header"],
  [/\/plans\/\[planSetId\]\//, "plan viewer: full-screen workspace with a toolbar"],
  [/\/takeoff\/\[takeoffId\]\//, "takeoff workspace: full-screen with a toolbar"],
];

function pages(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pages(p) : n === "page.tsx" ? [p] : [];
  });
}

function resolveImport(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base + ".tsx", base + ".ts", join(base, "index.tsx")]) if (existsSync(c)) return c;
  return null;
}

function hasHeader(file, depth, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const s = readFileSync(file, "utf8");
  if (HEADER.test(s)) return true;
  if (depth === 0) return false;
  for (const m of s.matchAll(/from\s+"([^"]+)"/g)) {
    const r = resolveImport(m[1], file);
    if (r && !r.includes("/components/ui/") && hasHeader(r, depth - 1, seen)) return true;
  }
  return false;
}

const all = pages(join(SRC, "app")).sort();
const rows = { headed: [], redirect: [], own: [], missing: [] };
for (const p of all) {
  const rel = relative(ROOT, p);
  const s = readFileSync(p, "utf8");
  const own = OWN_HEADER.find(([re]) => re.test("/" + rel));
  if (/\bredirect\(/.test(s) && !/return\s*\(?\s*</.test(s)) rows.redirect.push(rel);
  else if (own) rows.own.push(`${rel} — ${own[1]}`);
  else if (hasHeader(p, 2)) rows.headed.push(rel);
  else rows.missing.push(rel);
}
const office = rows.headed.length + rows.missing.length;
console.log(`PageHeader / EntityHeader: ${rows.headed.length} / ${office} office pages`);
console.log(`redirects (no page): ${rows.redirect.length}; own header by design: ${rows.own.length}; total page.tsx: ${all.length}`);
if (process.argv.includes("--list")) for (const r of rows.own) console.log("  own: " + r);
for (const r of rows.missing) console.log("  MISSING: " + r);
process.exit(rows.missing.length ? 1 : 0);
