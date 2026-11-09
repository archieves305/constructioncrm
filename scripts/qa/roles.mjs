// Refusal checks as a SALES_REP dev server against the records flows.mjs made
// as the ADMIN (the rep has no part in that job). Every refusal must answer
// 403 / 404 and a 403 must say who may do it; the rep's own work still goes through.
// usage: node scripts/qa/roles.mjs
import { assertLocalDatabase, BASE, expect, readState, recorder, waitForServer } from "./lib.mjs";

assertLocalDatabase();
const me = (await waitForServer())?.user;
expect(me?.role === "SALES_REP", `roles.mjs needs a SALES_REP dev server (got ${me?.role})`);
const st = readState();
for (const k of ["jobId", "leadId", "permitId", "expenseId", "coId", "laborId", "calTaskId"]) expect(st[k], `qa-out/state.json has no ${k} — run flows.mjs first`);

const rec = recorder("roles");
async function call(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { cookie: "careyos_session=dev", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}
const refused = (expected, sentence = false) => async ([method, url, body]) => {
  const r = await call(method, url, body);
  expect(expected.includes(r.status), `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  if (sentence && r.status === 403) expect(r.body?.error && r.body.error !== "Forbidden", `bare "${r.body?.error}"`);
  return `${r.status}${r.body?.error ? ` "${String(r.body.error).slice(0, 90)}"` : ""}`;
};

rec.group = "off-scope records answer 404";
for (const u of [`/api/jobs/${st.jobId}`, `/api/leads/${st.leadId}`, `/api/permits/${st.permitId}`]) {
  await rec.step(`GET ${u}`, () => refused([404])(["GET", u]));
}

rec.group = "money and approvals refused with a sentence";
const checks = [
  ["POST", `/api/expenses/${st.expenseId}/review`, { decision: "APPROVE" }],
  ["POST", `/api/change-orders/${st.coId}/decision`, { decision: "APPROVE", name: "x" }],
  ["POST", `/api/labor-contracts/${st.laborId}/payments`, { amount: 1 }],
  ["POST", "/api/tasks/bulk", { action: "reschedule", ids: [st.calTaskId], dueAt: "2026-12-01" }],
  ["PATCH", `/api/tasks/${st.calTaskId}`, { status: "COMPLETED" }],
  ["DELETE", `/api/tasks/${st.calTaskId}`],
  ["GET", "/api/reports/financials"],
];
for (const c of checks) await rec.step(`${c[0]} ${c[1]}`, () => refused([403, 404], true)(c));

rec.group = "own work still allowed";
await rec.step("POST /api/tasks (own task)", async () => {
  const r = await call("POST", "/api/tasks", { title: "QA rep own task" });
  expect(r.status === 201, `${r.status}`);
  return true;
});

process.exit(rec.finish() ? 1 : 0);
