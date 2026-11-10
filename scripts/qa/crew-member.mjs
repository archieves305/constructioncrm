// Crew Release 2 checks, as a CREW_MEMBER dev server (the rep account; run.sh
// puts the role back): a W2 worker linked to a crew that is on flows.mjs's job.
// They contribute (photos, problems) but never keep the log or the crew sheet,
// never raise tasks for others, never see money, contracts or customer contact.
// usage: node scripts/qa/crew-member.mjs
import { assertLocalDatabase, BASE, expect, readState, recorder, sql, waitForServer } from "./lib.mjs";

assertLocalDatabase();
const me = (await waitForServer())?.user;
expect(me?.role === "CREW_MEMBER", `crew-member.mjs needs a CREW_MEMBER dev server (got ${me?.role})`);
const st = readState();
expect(st.jobId, "qa-out/state.json has no jobId — run flows.mjs first");
const rec = recorder("crew-member");
const one = (q) => sql(q).split("\n")[0];
const today = sql(`select to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')`);
async function call(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { cookie: "careyos_session=dev", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

// Setup: the worker in a crew assigned to the job (no field assignment, no PM).
const job = st.jobId;
const admin = sql(`select id from users u where exists (select 1 from roles r where r.id = u.role_id and r.name = 'ADMIN') order by created_at limit 1`);
sql(`update leads set primary_phone = '305-555-0142' where id = (select lead_id from jobs where id = '${job}')`);
const crewId = one(`insert into crews (id, name, updated_at) values ('qa-crew-m-${Date.now()}', 'QA Member Crew', now()) returning id`);
sql(`insert into personnel (id, first_name, last_name, crew_id, user_id, created_by_user_id, updated_at) values ('qa-pers-m-${Date.now()}', 'QA', 'Worker', '${crewId}', '${me.id}', '${admin}', now()) on conflict (user_id) do update set crew_id = excluded.crew_id`);
sql(`insert into crew_assignments (id, job_id, crew_id, install_date, start_minutes) values ('qa-ca-m-${Date.now()}', '${job}', '${crewId}', '${today}T12:00:00Z', 420)`);
const estimateId = one(`insert into files (id, job_id, lead_id, file_name, file_type, storage_key, file_size, category, uploaded_by_user_id) values ('qa-file-m-${Date.now()}', '${job}', (select lead_id from jobs where id = '${job}'), 'QA estimate.pdf', 'application/pdf', 'qa/missing.pdf', 10, 'ESTIMATE', '${admin}') returning id`);

rec.group = "their day";
await rec.step("Crew today shows the job through their crew, no customer phone", async () => {
  const r = await call("GET", `/api/mobile/crew/today?date=${today}`);
  expect(r.status === 200 && r.body.jobs.some((j) => j.jobId === job), `today ${r.status}`);
  expect(!JSON.stringify(r.body).includes("305-555-0142"), "customer phone in the answer");
  return `${r.body.jobs.length} job(s)`;
});

rec.group = "contribute";
await rec.step("Reports a problem on the job (201)", async () => {
  const id = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.padEnd(24, "0").slice(0, 24);
  const r = await call("POST", `/api/jobs/${job}/field-issues`, { id, type: "OFFICE_FOLLOW_UP", title: "Blocked: no power on site" });
  expect(r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  return String(r.status);
});

rec.group = "refused";
const refusals = [
  ["PUT", `/api/jobs/${job}/daily-logs/${today}`, { workPerformed: "x" }, "daily log"],
  ["PUT", `/api/jobs/${job}/daily-logs/${today}/labor`, { entries: [] }, "crew sheet"],
  ["POST", "/api/tasks", { title: "QA member task", jobId: job }, "task for others"],
  ["GET", `/api/files/${estimateId}?meta=1`, null, "estimate file"],
  ["GET", `/api/jobs/${job}/payments`, null, "job payments (money)"],
  ["GET", `/api/personnel/x/login`, null, "personnel logins"],
];
for (const [m, u, b, what] of refusals) {
  await rec.step(`${what}: ${m} ${u.replace(job, ":job")}`, async () => {
    const r = await call(m, u, b ?? undefined);
    expect([401, 403, 404].includes(r.status), `answered ${r.status}`);
    return String(r.status);
  });
}

process.exit(rec.finish() ? 1 : 0);
