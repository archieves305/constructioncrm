// Crew Release 1 checks, as a CREW_LEAD dev server, on the job flows.mjs made
// as the ADMIN. The rep account runs as the crew lead (the dev bypass writes the
// role; run.sh puts it back). Setup rows are written with SQL; run.sh restores
// the whole dev database afterwards.
//   - one "on the job" rule: a crew lead on the job reads its files AND its logs
//   - crews see only the allowed kinds of file; Show / Hide per file
//   - no customer phone or email in any response a crew lead gets
//   - the crew day and week; Got it / Can't make it; a problem goes to the PM
// usage: node scripts/qa/crew.mjs
import { assertLocalDatabase, BASE, expect, readState, recorder, sql, waitForServer } from "./lib.mjs";

assertLocalDatabase();
const me = (await waitForServer())?.user;
expect(me?.role === "CREW_LEAD", `crew.mjs needs a CREW_LEAD dev server (got ${me?.role})`);
const st = readState();
expect(st.jobId, "qa-out/state.json has no jobId — run flows.mjs first");
const rec = recorder("crew");
const PHONE = "305-555-0142";
/** An INSERT … RETURNING through psql also prints its command tag; keep the value. */
const one = (q) => sql(q).split("\n")[0];
const today = sql(`select to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')`);

async function call(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { cookie: "careyos_session=dev", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

// ── setup: the crew lead on the job by a crew install day (no field assignment) ──
const job = st.jobId;
const admin = sql(`select id from users u where exists (select 1 from roles r where r.id = u.role_id and r.name = 'ADMIN') order by created_at limit 1`);
sql(`update leads set primary_phone = '${PHONE}', email = 'qa-customer@example.com' where id = (select lead_id from jobs where id = '${job}')`);
sql(`update jobs set project_manager_id = '${admin}' where id = '${job}'`);
sql(`update users set phone = '305-555-0199' where id = '${admin}'`);
const crewId = one(`insert into crews (id, name, updated_at) values ('qa-crew-${Date.now()}', 'QA Crew', now()) returning id`);
sql(`insert into personnel (id, first_name, last_name, crew_id, user_id, created_by_user_id, updated_at) values ('qa-pers-${Date.now()}', 'QA', 'Lead', '${crewId}', '${me.id}', '${admin}', now()) on conflict (user_id) do update set crew_id = excluded.crew_id`);
const caId = one(`insert into crew_assignments (id, job_id, crew_id, install_date, start_minutes) values ('qa-ca-${Date.now()}', '${job}', '${crewId}', '${today}T12:00:00Z', 450) returning id`);
const file = (cat, name) => one(`insert into files (id, job_id, lead_id, file_name, file_type, storage_key, file_size, category, uploaded_by_user_id) values ('qa-file-${cat}-${Date.now()}', '${job}', (select lead_id from jobs where id = '${job}'), '${name}', 'application/pdf', 'qa/missing.pdf', 10, '${cat}', '${admin}') returning id`);
const estimateId = file("ESTIMATE", "QA estimate.pdf");
const planId = file("PLAN_SET", "QA plans.pdf");

rec.group = "one on-the-job rule";
await rec.step("On the job through a crew install day: the job, its files and its logs all answer", async () => {
  const [j, f, logs] = await Promise.all([call("GET", `/api/jobs/${job}`), call("GET", `/api/files?jobId=${job}`), call("GET", `/api/jobs/${job}/daily-logs`)]);
  expect(j.status === 200 && f.status === 200 && logs.status === 200, `job ${j.status}, files ${f.status}, logs ${logs.status}`);
  return "200 / 200 / 200";
});

rec.group = "documents";
await rec.step("Crews see plans, not estimates", async () => {
  const f = await call("GET", `/api/files?jobId=${job}`);
  const ids = [...(f.body.files ?? []), ...(f.body.leadFiles ?? [])].map((x) => x.id);
  expect(ids.includes(planId), "plan set missing");
  expect(!ids.includes(estimateId), "estimate listed");
  const byId = await call("GET", `/api/files/${estimateId}?meta=1`);
  expect(byId.status === 404, `estimate by id answered ${byId.status}`);
  return `${ids.length} files listed; estimate 404`;
});
await rec.step("A crew lead cannot show a file to crews", async () => {
  const r = await call("PATCH", `/api/files/${estimateId}`, { crewVisible: true });
  expect(r.status === 403 || r.status === 404, `answered ${r.status}`);
  return String(r.status);
});
await rec.step("An office Show to crews makes that one estimate visible", async () => {
  sql(`update files set crew_visible = true where id = '${estimateId}'`);
  const shown = await call("GET", `/api/files/${estimateId}?meta=1`);
  sql(`update files set crew_visible = null where id = '${estimateId}'`);
  expect(shown.status === 200, `answered ${shown.status}`);
  return "200";
});

await rec.step("Plans: the job's sheets list; refused once an admin stops sharing plans", async () => {
  const ok = await call("GET", `/api/jobs/${job}/plan-sheets`);
  expect(ok.status === 200 && Array.isArray(ok.body?.sheets), `list ${ok.status}`);
  const had = sql(`select count(*) from labor_settings`);
  if (had === "0") sql(`insert into labor_settings (id, updated_at, crew_file_categories) values ('qa-ls', now(), ARRAY['PHOTOS']::"FileCategory"[])`);
  else sql(`update labor_settings set crew_file_categories = ARRAY['PHOTOS']::"FileCategory"[]`);
  const no = await call("GET", `/api/jobs/${job}/plan-sheets`);
  if (had === "0") sql(`delete from labor_settings where id = 'qa-ls'`);
  else sql(`update labor_settings set crew_file_categories = ARRAY['PLAN_SET','PHOTOS','VIDEO','PERMIT','INSPECTION']::"FileCategory"[]`);
  expect(no.status === 403, `after unsharing ${no.status}`);
  return `${ok.body.sheets.length} sheets; then 403`;
});

rec.group = "no customer contact";
await rec.step("No customer phone or email in the job, lead, list, task or calendar answers", async () => {
  const leadId = sql(`select lead_id from jobs where id = '${job}'`);
  const urls = [`/api/jobs/${job}`, `/api/leads/${leadId}`, `/api/jobs?scope=all`, `/api/calendar?view=week&date=${today}`, `/api/mobile/crew/today?date=${today}`, `/api/mobile/crew/week?from=${today}`];
  const leaks = [];
  for (const u of urls) {
    const r = await call("GET", u);
    const text = JSON.stringify(r.body ?? "");
    if (text.includes(PHONE) || text.includes("qa-customer@example.com")) leaks.push(u);
  }
  expect(leaks.length === 0, `leaked in ${leaks.join(", ")}`);
  return `${urls.length} answers clean`;
});

rec.group = "crew day and week";
await rec.step("Today shows the job first, with the start time and the PM to call", async () => {
  const r = await call("GET", `/api/mobile/crew/today?date=${today}`);
  const card = r.body?.jobs?.[0];
  expect(r.status === 200 && card?.jobId === job, `first card ${card?.jobId} (${r.status})`);
  expect(card.installToday && card.startMinutes === 450, `install ${card.installToday}, start ${card.startMinutes}`);
  expect(card.pm?.phone === "305-555-0199", `pm phone ${card.pm?.phone}`);
  return `${r.body.jobs.length} job(s); start 7:30`;
});
await rec.step("Week lists the install day; Got it is recorded", async () => {
  const w = await call("GET", `/api/mobile/crew/week?from=${today}`);
  expect(w.body?.days?.[0]?.items?.some((i) => i.crewAssignmentId === caId), "install day missing from week");
  const a = await fetch(BASE + `/api/crew-assignments/${caId}/ack`, { method: "POST", headers: { cookie: "careyos_session=dev", "content-type": "application/json", "idempotency-key": `qa-ack-${Date.now()}` }, body: JSON.stringify({ answer: "CONFIRMED" }) });
  expect(a.status === 200, `ack ${a.status}`);
  const saved = sql(`select confirmation || '/' || (confirmed_by_user_id = '${me.id}') from crew_assignments where id = '${caId}'`);
  expect(saved === "CONFIRMED/true", `saved ${saved}`);
  return saved;
});
await rec.step("Can't make it gives the PM a task due today", async () => {
  const r = await call("POST", `/api/crew-assignments/${caId}/ack`, { answer: "CANT_MAKE_IT", note: "Truck broke down" });
  expect(r.status === 200, `ack ${r.status}`);
  const t = sql(`select assigned_user_id || '/' || priority from tasks where job_id = '${job}' and title like '%can''t make the%install day%' order by created_at desc limit 1`);
  expect(t === `${admin}/HIGH`, `task ${t}`);
  return t;
});

rec.group = "report a problem";
await rec.step("A problem with nobody named goes to the PM", async () => {
  const id = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.padEnd(24, "0").slice(0, 24);
  const r = await call("POST", `/api/jobs/${job}/field-issues`, { id, type: "OFFICE_FOLLOW_UP", title: "Can't get on site: gate locked", priority: "HIGH" });
  expect(r.status === 201 || r.status === 200, `post ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const who = sql(`select coalesce(assigned_user_id, 'nobody') from field_issues where id = '${id}'`);
  expect(who === admin, `assigned to ${who}`);
  return "to the PM";
});

process.exit(rec.finish() ? 1 : 0);
