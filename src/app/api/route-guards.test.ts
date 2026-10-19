import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route handler that reads the session must also check who is asking:
 * a role list, a record scope or a grant. A handler that only checks for a
 * session lets any signed-in person — a crew lead, marketing, read-only —
 * read or change whatever its id names (the 2026-10-19 audit found invoice
 * PDFs, receipts and every lead's contact details open that way).
 *
 * This reads the source of each handler. A guard is recognised by name
 * (guardJob, canManageJobMoney, requireCase, permitInScope, jobAccessWhere,
 * visibilityScopeFor, forbidden(), a role comparison, or a file's own `guard()`
 * wrapper around one of these). A handler that checks access some other way, or that
 * serves reference data any signed-in user may read, is listed below with
 * the reason; a new one fails here until it gets a guard or a reviewed entry.
 */
const ROOT = path.join(__dirname);

const GUARD = /\b(guard[A-Z]\w*|can[A-Z]\w*|require[A-Z]\w*|forbidden\(|isOwnOnlyRole|hasRole|\w+InScope\(|\w+AccessWhere\(|visibilityScopeFor\(|jobScopeFor\(|buildTaskListWhere\(|\bguard\(|\bscoped\(|role\s*(===|!==)|\.includes\(session\.user\.role\)|session\.user\.role|Scope\w*\(|templateActor|requireCronSecret|verify\w*\()/;

/** Reviewed: access is checked inside the service the handler calls, or the data is not tied to anyone. */
const REVIEWED: Record<string, string> = {
  "admin/estimate-brand/logo/preview GET": "brand logo shown on every estimate",
  "admin/estimate-brand GET": "brand name and colours for estimate PDFs",
  "admin/job-task-templates GET": "template catalog, no records",
  "admin/payment-sources GET": "picker options (Zelle, check…)",
  "admin/roofing-brand/logo/preview GET": "brand logo shown on roofing estimates",
  "admin/roofing-brand GET": "brand name and colours for roofing PDFs",
  "admin/services GET": "service catalog for lead forms",
  "admin/sources GET": "lead source catalog for lead forms",
  "admin/stages GET": "stage catalog for boards",
  "admin/templates GET": "message template catalog for composers",
  "company-documents/[id] DELETE": "deleteDocument checks the vault viewer (vaultViewerFor)",
  "cost-codes GET": "cost code catalog",
  "crews GET": "crew names for pickers",
  "estimate-templates GET": "estimate template catalog, no prices",
  "jobs/[id]/budget/template GET": "a blank CSV template",
  "jobs/stages GET": "stage catalog for boards",
  "leads GET": "buildLeadListWhere floors own-only roles to their leads",
  "me/preferences GET": "the signed-in person's own settings",
  "me/preferences PATCH": "the signed-in person's own settings",
  "me GET": "the signed-in person",
  "notifications/[id]/read POST": "markRead is scoped to the recipient",
  "notifications/read-all POST": "scoped to the recipient",
  "notifications/unread-count GET": "scoped to the recipient",
  "permit-types GET": "permit type catalog",
  "tasks/summary GET": "counts through taskVisibilityFilter for the viewer",
  "users/assignable GET": "names for assignee pickers",
  "vendors/options GET": "vendor names for pickers",
  "violations/[id] GET": "readCase checks the case scope",
  "violations/categories GET": "category catalog",
  "violations/hearings GET": "listHearings is scoped to the viewer's cases",
  "violations/inspections GET": "listInspections is scoped to the viewer's cases",
  "violations GET": "listCases is scoped to the viewer",
  "violations/summary GET": "caseSummary is scoped to the viewer",
  "workflow-templates GET": "template catalog",
  "zylow/autocomplete GET": "public property search (address suggestions)",
  "zylow/nearby GET": "public property search",
  "zylow/property/[id]/comps GET": "public property data",
  "zylow/property/[id] GET": "public property data",
  "zylow/whoami GET": "integration status",
};

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

function sessionOnlyHandlers(): string[] {
  const found: string[] = [];
  for (const file of routeFiles(ROOT)) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("getSession")) continue;
    const route = path.relative(ROOT, path.dirname(file)).split(path.sep).join("/");
    const parts = src.split(/export async function (GET|POST|PATCH|PUT|DELETE)\b/);
    for (let i = 1; i < parts.length; i += 2) {
      const body = parts[i + 1].split(/\nexport /)[0];
      if (body.includes("getSession") && !GUARD.test(body)) found.push(`${route} ${parts[i]}`);
    }
  }
  return found.sort();
}

describe("route guards", () => {
  const found = sessionOnlyHandlers();

  it("every handler that reads the session checks a role, a scope or a grant (or is reviewed)", () => {
    expect(found.filter((h) => !(h in REVIEWED))).toEqual([]);
  });

  it("the reviewed list holds no stale entries", () => {
    expect(Object.keys(REVIEWED).filter((h) => !found.includes(h))).toEqual([]);
  });
});
