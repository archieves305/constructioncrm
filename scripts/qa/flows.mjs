// Workflow regression: the audit's 14 flows in headless Chromium as an ADMIN dev server,
// each step asserting what should happen. Writes throw-away records named "QA …";
// run.sh dumps the dev database first and restores it afterwards.
// usage: node scripts/qa/flows.mjs [flowRegex]
import { firstFieldMessage } from "../../src/lib/validation/messages.ts";
import { apiFor, assertLocalDatabase, BASE, expect, launch, newContext, readState, recorder, samplePdf, sql, waitForServer, writeState } from "./lib.mjs";

assertLocalDatabase();
const me = (await waitForServer())?.user;
expect(me?.role === "ADMIN", `flows need an ADMIN dev server (got ${me?.role})`);
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

const browser = await launch();
const ctx = await newContext(browser);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
page.on("dialog", (d) => { pageErrors.push(`native ${d.type()}: ${d.message().slice(0, 80)}`); d.accept(); });
const api = apiFor(page);
const rec = recorder(only ? "flows-partial" : "flows");
const state = { ...readState(), userId: me.id };
const STAMP = Date.now().toString(36);
const go = async (u) => { await page.goto(BASE + u, { waitUntil: "networkidle", timeout: 90000 }); await page.waitForTimeout(700); };
const text = async () => page.locator("main").innerText().catch(() => page.locator("body").innerText());
const dialog = () => page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
const idOf = (b) => b?.id ?? b?.task?.id ?? b?.permit?.id ?? b?.expense?.id ?? b?.contract?.id ?? b?.request?.id ?? b?.changeOrder?.id ?? b?.estimate?.id;
const ok = (r, what) => expect(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
const flows = {};

flows.lead = async () => {
  await rec.step("New Lead: an empty submit shows the field errors without a request", async () => {
    await go("/leads/new");
    let posted = false;
    const onReq = (r) => { if (r.method() === "POST" && r.url().endsWith("/api/leads")) posted = true; };
    page.on("request", onReq);
    await page.getByRole("button", { name: "Create Lead" }).click();
    await page.waitForTimeout(800);
    page.off("request", onReq);
    const t = await text();
    expect(!posted, "the empty form was sent to the server");
    for (const m of ["First name is required", "Last name is required", "Property address is required", "City is required", "ZIP code is required"]) expect(t.includes(m), `missing "${m}"`);
    return true;
  });
  await rec.step("New Lead: fill and create", async () => {
    await page.fill("#firstName", "QA");
    await page.fill("#lastName", `Audit${STAMP}`);
    await page.fill("#primaryPhone", "(305) 555-0142");
    await page.fill("#email", `qa-${STAMP}@example.invalid`);
    await page.fill("#propertyAddress1", "100 QA Audit Way");
    await page.fill("#city", "Miami");
    await page.fill("#zipCode", "33101");
    await page.getByRole("button", { name: "Create Lead" }).click();
    await page.waitForURL(/\/leads\/c[a-z0-9]+/, { timeout: 20000 });
    state.leadId = page.url().split("/leads/")[1].split(/[?#/]/)[0];
    return `lead ${state.leadId}`;
  });
  await rec.step("An estimate on the lead, marked sent", async () => {
    const r = await api("POST", `/api/leads/${state.leadId}/template-estimates`, {
      templateCategory: "DRYWALL", name: "QA estimate", marginPercent: 20, status: "SENT",
      sections: [{ title: "Walls", items: [{ description: "Drywall", quantity: 10, unitType: "EACH", unitPrice: 20, costType: "MATERIAL" }] }],
    });
    ok(r, "estimate create");
    state.estimateId = idOf(r.body);
    return true;
  });
  await rec.step("Won from the lead page offers the estimate and creates the job", async () => {
    await go(`/leads/${state.leadId}`);
    await page.getByRole("button", { name: /^Won$/ }).first().click();
    // The picker loads its estimates after the dialog opens (slow on a cold dev compile).
    const offered = await dialog().getByText(/QA estimate/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    expect(offered, "the Won dialog does not offer the estimate");
    await dialog().getByRole("button", { name: /move to won|confirm|won/i }).last().click();
    await page.waitForTimeout(2500);
    const jobs = await api("GET", `/api/jobs?search=Audit${STAMP}`);
    const list = jobs.body?.jobs ?? jobs.body?.data ?? jobs.body ?? [];
    const j = Array.isArray(list) ? list[0] : null;
    expect(j, "no job was created");
    state.jobId = j.id;
    return `${j.jobNumber} contract ${j.contractAmount}`;
  });
  await rec.step("The job opens on Overview", async () => {
    await go(`/jobs/${state.jobId}`);
    expect(/Overview/.test(await text()), "no Overview");
    return true;
  });
};

flows.task = async () => {
  await rec.step("New task: Create is disabled without a title", async () => {
    await go("/tasks?scope=all");
    await page.getByRole("button", { name: "New task" }).first().click();
    await page.waitForTimeout(500);
    expect(await page.getByRole("button", { name: "Create task" }).isDisabled(), "Create is enabled with no title");
    return true;
  });
  await rec.step("Create a task due tomorrow", async () => {
    await page.getByLabel("Task title").fill(`QA task ${STAMP}`);
    const tomorrow = page.getByRole("button", { name: /^Tomorrow$/ }).first();
    if (await tomorrow.count()) await tomorrow.click();
    await page.getByRole("button", { name: "Create task" }).click();
    await page.waitForTimeout(1500);
    state.taskId = sql(`select id from tasks where title = 'QA task ${STAMP}'`);
    expect(state.taskId, "task not saved");
    return true;
  });
  await rec.step("Open the sheet and add a note", async () => {
    await go(`/tasks?scope=all&task=${state.taskId}`);
    await page.waitForTimeout(800);
    const box = page.getByRole("dialog").getByRole("textbox").last();
    await box.fill("QA note");
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(1200);
    let t = await page.getByRole("dialog").innerText();
    if (!t.includes("QA note")) {
      const send = page.getByRole("dialog").getByRole("button", { name: /add note|post|send|comment/i }).first();
      if (await send.count()) { await send.click(); await page.waitForTimeout(1200); t = await page.getByRole("dialog").innerText(); }
    }
    expect(t.includes("QA note"), "note not shown");
    return true;
  });
  await rec.step("Complete, then reopen: completedAt follows", async () => {
    ok(await api("PATCH", `/api/tasks/${state.taskId}`, { status: "COMPLETED" }), "complete");
    const done = sql(`select status || '/' || (completed_at is not null) from tasks where id = '${state.taskId}'`);
    ok(await api("PATCH", `/api/tasks/${state.taskId}`, { status: "PENDING" }), "reopen");
    const open = sql(`select status || '/' || (completed_at is not null) from tasks where id = '${state.taskId}'`);
    expect(done === "COMPLETED/true" && open === "PENDING/false", `got ${done} then ${open}`);
    return true;
  });
};

flows.taskvis = async () => {
  await rec.step("A task made on Tasks (Mine) is assigned to its maker and stays in view", async () => {
    await go("/tasks");
    await page.getByRole("button", { name: "New task" }).first().click();
    await page.waitForTimeout(400);
    await page.getByLabel("Task title").fill(`QA vis ${STAMP}`);
    await page.getByRole("button", { name: "Create task" }).click();
    await page.waitForTimeout(2500);
    const who = sql(`select coalesce(assigned_user_id, 'nobody') from tasks where title = 'QA vis ${STAMP}'`);
    expect(who === me.id, `assigned to ${who}`);
    expect((await text()).includes(`QA vis ${STAMP}`), "not in the list after Create");
    return true;
  });
  await rec.step("Quick add on Mine also assigns its maker", async () => {
    await go("/tasks");
    const box = page.getByPlaceholder(/Quick add/);
    await box.fill(`QA quick ${STAMP}`);
    await box.press("Enter");
    await page.waitForTimeout(2000);
    const who = sql(`select coalesce(assigned_user_id, 'nobody') from tasks where title = 'QA quick ${STAMP}'`);
    expect(who === me.id, `assigned to ${who}`);
    return true;
  });
};

flows.files = async () => {
  await rec.step("Upload a PDF on the job's Files tab", async () => {
    await go(`/jobs/${state.jobId}?tab=files`);
    await page.locator("input[type=file]").first().setInputFiles(samplePdf());
    await page.waitForTimeout(3000);
    state.fileId = sql(`select id from files where job_id = '${state.jobId}' and file_name like 'QA sample%' order by created_at desc limit 1`);
    expect(state.fileId, "file not stored");
    return true;
  });
  await rec.step("The file opens in the preview; download answers 200 as an attachment", async () => {
    await page.getByText(/QA sample/).first().click();
    await page.waitForTimeout(1500);
    expect(await page.getByRole("dialog").count(), "no preview dialog");
    const r = await page.request.get(`${BASE}/api/files/${state.fileId}?download=1`);
    expect(r.status() === 200 && /attachment/.test(r.headers()["content-disposition"] ?? ""), `download ${r.status()}`);
    await page.keyboard.press("Escape");
    return true;
  });
  await rec.step("Delete the file → 404 afterwards", async () => {
    ok(await api("DELETE", `/api/files/${state.fileId}`), "delete");
    const g = await page.request.get(`${BASE}/api/files/${state.fileId}?meta=1`);
    expect(g.status() === 404, `then ${g.status()}`);
    return true;
  });
};

flows.permit = async () => {
  await rec.step("Bad permit values are refused with the field named", async () => {
    const fee = await api("POST", `/api/jobs/${state.jobId}/permits`, { municipality: "QA City", permitFee: "abc" });
    const date = await api("POST", `/api/jobs/${state.jobId}/permits`, { municipality: "QA City", expirationDate: "tomorrow" });
    const status = await api("POST", `/api/jobs/${state.jobId}/permits`, { municipality: "QA City", status: "X" });
    expect(fee.status === 400 && /Permit fee/.test(fee.body?.error), `fee ${fee.status} ${fee.body?.error}`);
    expect(date.status === 400 && /Expiration date/.test(date.body?.error), `date ${date.status} ${date.body?.error}`);
    expect(status.status === 400 && /Status/.test(status.body?.error), `status ${status.status} ${status.body?.error}`);
    return true;
  });
  await rec.step("Add a permit to the job", async () => {
    const r = await api("POST", `/api/jobs/${state.jobId}/permits`, { municipality: "QA City", permitType: "BUILDING", status: "APPLIED", permitNumber: `QA-${STAMP}`, permitFee: "125" });
    expect(r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    state.permitId = idOf(r.body);
    return true;
  });
  await rec.step("A failed inspection raises a correction task on the job", async () => {
    const c = await api("POST", `/api/permits/${state.permitId}/inspections`, { type: "FRAMING", scheduledDate: "2026-11-10" });
    ok(c, "inspection create");
    ok(await api("PATCH", `/api/inspections/${idOf(c.body)}`, { result: "FAIL", notes: "QA: blocking missing" }), "record FAIL");
    const n = Number(sql(`select count(*) from tasks where job_id = '${state.jobId}' and title ilike '%correct%'`));
    expect(n > 0, "no correction task");
    return true;
  });
  await rec.step("The permit page is titled by its type and address; tabs stay on one row at 400 px", async () => {
    await page.setViewportSize({ width: 400, height: 860 });
    await go(`/permits/${state.permitId}`);
    const h1 = (await page.locator("h1").first().innerText()).trim();
    const rows = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll("[role=tab]")];
      return new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size;
    });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(/^Building permit #QA-/.test(h1) && h1.includes("—"), `title "${h1}"`);
    expect(rows === 1, `tabs on ${rows} rows`);
    expect(sw <= 401, `page scrolls sideways (${sw})`);
    return true;
  });
};

flows.expense = async () => {
  await rec.step("A negative amount is refused with a plain sentence", async () => {
    const r = await api("POST", `/api/jobs/${state.jobId}/expenses`, { type: "MATERIAL", vendor: "QA", amount: -5, incurredDate: "2026-11-08" });
    expect(r.status === 400 && r.body?.error === "Amount must be 0 or more", `${r.status} "${r.body?.error}"`);
    return true;
  });
  await rec.step("A pending expense is approved from Money → Expenses", async () => {
    const r = await api("POST", `/api/jobs/${state.jobId}/expenses`, { type: "MATERIAL", vendor: `QA Supply ${STAMP}`, amount: 123.45, incurredDate: "2026-11-08" });
    ok(r, "expense create");
    state.expenseId = idOf(r.body);
    // An admin's expense is approved on entry; put it back in the queue as a rep's would be.
    sql(`update job_expenses set status = 'PENDING', approved_by_user_id = null, approved_at = null where id = '${state.expenseId}' returning id`);
    await go(`/jobs/${state.jobId}?tab=money&sub=expenses`);
    await page.getByRole("button", { name: /^Approve$/ }).first().click();
    await page.waitForTimeout(1500);
    const st = sql(`select status from job_expenses where id = '${state.expenseId}'`);
    expect(st === "APPROVED", st);
    return true;
  });
  await rec.step("Deleting an expense asks in an in-app dialog (no browser confirm), and Cancel keeps it", async () => {
    const r = await api("POST", `/api/jobs/${state.jobId}/expenses`, { type: "MATERIAL", vendor: `QA Delete ${STAMP}`, amount: 9.99, incurredDate: "2026-11-08" });
    ok(r, "expense create");
    const id = idOf(r.body);
    await go(`/jobs/${state.jobId}?tab=money&sub=expenses`);
    // Each expense is a card; its delete button is named from its title ("Delete expense").
    const row = page.locator('[data-slot="card"]').filter({ hasText: `QA Delete ${STAMP}` }).last();
    await row.getByRole("button", { name: /^delete/i }).click();
    await dialog().getByText("Delete this expense?").waitFor({ timeout: 10000 });
    await dialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(800);
    expect(sql(`select count(*) from job_expenses where id = '${id}'`) === "1", "Cancel deleted the expense");
    await row.getByRole("button", { name: /^delete/i }).click();
    await dialog().getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(1500);
    expect(sql(`select count(*) from job_expenses where id = '${id}'`) === "0", "Delete did not remove the expense");
    return true;
  });
};

flows.crewpay = async () => {
  await rec.step("Payment request → recorded payment → request paid, task done", async () => {
    const c = await api("POST", `/api/jobs/${state.jobId}/labor-contracts`, { label: `QA Crew ${STAMP}`, contractAmount: 1000 });
    ok(c, "contract");
    state.laborId = idOf(c.body);
    const q = await api("POST", `/api/labor-contracts/${state.laborId}/payment-requests`, { amount: 400, note: "QA draw" });
    ok(q, "request");
    ok(await api("POST", `/api/labor-contracts/${state.laborId}/payments`, { amount: 400, requestId: idOf(q.body), method: "CHECK" }), "payment");
    const st = sql(`select r.status || '/' || coalesce(t.status::text, 'no task') from labor_payment_requests r left join tasks t on t.id = r.task_id where r.id = '${idOf(q.body)}'`);
    expect(st === "PAID/COMPLETED", st);
    return true;
  });
  await rec.step("Money → Crew contracts & payments shows the contract and the payment", async () => {
    await go(`/jobs/${state.jobId}?tab=money&sub=crew-pay`);
    const t = await text();
    expect(t.includes("QA Crew") && t.includes("$400"), "not shown under Money");
    return true;
  });
};

flows.co = async () => {
  await rec.step("A zero price is refused with a message", async () => {
    const r = await api("POST", `/api/jobs/${state.jobId}/change-orders`, { title: "QA", customerPrice: 0 });
    expect(r.status === 400, `${r.status}`);
    const sentence = r.body?.error === "Validation failed" ? firstFieldMessage(r.body.fields) : r.body?.error;
    expect(sentence && sentence !== "Validation failed", `no sentence for the toast: ${JSON.stringify(r.body).slice(0, 120)}`);
    return `toast: "${sentence}"`;
  });
  await rec.step("Approve a change order once; a second decision is refused; the contract moves", async () => {
    const before = Number(sql(`select contract_amount from jobs where id = '${state.jobId}'`));
    const c = await api("POST", `/api/jobs/${state.jobId}/change-orders`, { title: `QA CO ${STAMP}`, customerPrice: 500, crewCost: 100 });
    ok(c, "create");
    state.coId = idOf(c.body);
    ok(await api("POST", `/api/change-orders/${state.coId}/decision`, { decision: "APPROVE", name: "QA" }), "approve");
    const again = await api("POST", `/api/change-orders/${state.coId}/decision`, { decision: "APPROVE", name: "QA" });
    const after = Number(sql(`select contract_amount from jobs where id = '${state.jobId}'`));
    expect(again.status >= 400, `second decision ${again.status}`);
    expect(after - before === 500, `contract ${before} → ${after}`);
    return true;
  });
  await rec.step("The change-order dialog's crew-contract picker shows the name, not the id", async () => {
    await go(`/jobs/${state.jobId}?tab=money&sub=change-orders`);
    await page.getByRole("button", { name: /new change order/i }).click();
    await page.waitForTimeout(700);
    const trigger = page.getByRole("dialog").locator("[data-slot=select-trigger]").last();
    await trigger.click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: /QA Crew/ }).first().click();
    await page.waitForTimeout(300);
    const shows = (await trigger.innerText()).trim();
    await page.keyboard.press("Escape");
    expect(/QA Crew/.test(shows), `shows "${shows}"`);
    return true;
  });
};

flows.log = async () => {
  const day = "2026-11-06";
  await rec.step("Office daily log: write, submit, approve; a second approval is refused", async () => {
    ok(await api("PUT", `/api/jobs/${state.jobId}/daily-logs/${day}`, { workPerformed: "QA framing" }), "write");
    ok(await api("POST", `/api/jobs/${state.jobId}/daily-logs/${day}/submit`, {}), "submit");
    ok(await api("POST", `/api/jobs/${state.jobId}/daily-logs/${day}/approve`, {}), "approve");
    const again = await api("POST", `/api/jobs/${state.jobId}/daily-logs/${day}/approve`, {});
    expect(again.status >= 400, `second approval ${again.status}`);
    await go(`/jobs/${state.jobId}/daily-logs/${day}`);
    expect((await text()).includes("QA framing"), "log text not shown");
    return true;
  });
};

flows.calendar = async () => {
  await rec.step("Calendar week: keyboard-drag a task one day to the right", async () => {
    const c = await api("POST", "/api/tasks", { title: `QA cal ${STAMP}`, dueAt: "2026-11-11", jobId: state.jobId, assignedUserId: me.id });
    ok(c, "task");
    state.calTaskId = idOf(c.body);
    await go("/calendar?view=week&date=2026-11-11");
    const card = page.locator("[aria-roledescription=draggable], [aria-roledescription=sortable]").filter({ hasText: `QA cal ${STAMP}` }).first();
    expect(await card.count(), "card not on the week");
    await card.focus();
    for (const k of ["Space", "ArrowRight", "Space"]) { await page.keyboard.press(k); await page.waitForTimeout(350); }
    await page.waitForTimeout(1200);
    const due = sql(`select to_char(due_at at time zone 'America/New_York', 'YYYY-MM-DD') from tasks where id = '${state.calTaskId}'`);
    expect(due === "2026-11-12", `due ${due}`);
    return true;
  });
};

flows.vendor = async () => {
  await rec.step("New vendor through the dialog; a duplicate name is refused", async () => {
    await go("/vendors");
    await page.getByRole("button", { name: /new vendor|add vendor/i }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("dialog").getByRole("textbox").first().fill(`QA Vendor ${STAMP}`);
    await page.getByRole("dialog").getByRole("button", { name: /create|save|add/i }).last().click();
    await page.waitForTimeout(1500);
    expect(sql(`select count(*) from vendors where name = 'QA Vendor ${STAMP}'`) === "1", "vendor not saved");
    const dup = await api("POST", "/api/vendors", { name: `QA Vendor ${STAMP}`, kind: "SUPPLIER" });
    expect(dup.status === 409 || dup.status === 400, `duplicate ${dup.status}`);
    return true;
  });
};

flows.bulk = async () => {
  await rec.step("Overdue filter → move two tasks to a day, after a confirmation", async () => {
    const ids = [];
    for (const i of [1, 2]) {
      const c = await api("POST", "/api/tasks", { title: `QA overdue ${i} ${STAMP}`, dueAt: "2026-11-02", assignedUserId: me.id });
      ok(c, "task");
      ids.push(idOf(c.body));
    }
    state.bulkIds = ids;
    await go(`/tasks?scope=all&overdue=1&q=${encodeURIComponent(`QA overdue`)}`);
    await page.getByLabel("Move to day").fill("2026-11-20");
    await page.getByRole("button", { name: "Move all to this day" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Go ahead" }).click();
    await page.waitForTimeout(2000);
    const due = sql(`select to_char(due_at at time zone 'America/New_York', 'YYYY-MM-DD') from tasks where id = '${ids[0]}'`);
    expect(due === "2026-11-20", `due ${due}`);
    return true;
  });
  await rec.step("Bulk close without a reason is refused with a plain sentence", async () => {
    const r = await api("POST", "/api/tasks/bulk", { action: "close", ids: state.bulkIds, reason: "" });
    expect(r.status === 400, `${r.status}`);
    const sentence = r.body?.error === "Validation failed" ? firstFieldMessage(r.body.fields) : r.body?.error;
    expect(sentence && sentence !== "Validation failed", `no sentence for the toast: ${JSON.stringify(r.body).slice(0, 120)}`);
    return `toast: "${sentence}"`;
  });
};

flows.pickers = async () => {
  for (const [label, match] of [["Target stage", /any stage/i], ["Message template", /no message/i]]) {
    await rec.step(`Follow-up rule → ${label} shows the picked name`, async () => {
      await go("/admin/follow-up-rules");
      await page.getByRole("button", { name: "New Rule" }).click();
      await page.waitForTimeout(700);
      if (label === "Target stage") {
        const trig = page.getByRole("dialog").locator("[data-slot=select-trigger]").first();
        await trig.click(); await page.waitForTimeout(300);
        await page.getByRole("option", { name: "Lead stage changed" }).click(); await page.waitForTimeout(300);
        expect((await trig.innerText()).trim() === "Lead stage changed", `trigger shows "${(await trig.innerText()).trim()}"`);
      }
      const triggers = page.getByRole("dialog").locator("[data-slot=select-trigger]");
      const n = await triggers.count();
      let t = null;
      for (let i = 0; i < n; i++) if (match.test(await triggers.nth(i).innerText())) { t = triggers.nth(i); break; }
      expect(t, `${label} picker not found`);
      await t.click(); await page.waitForTimeout(300);
      const opts = await page.getByRole("option").allInnerTexts();
      const i = opts.findIndex((o) => !/^(—|none|any)/i.test(o.trim()));
      if (i < 0) { await page.keyboard.press("Escape"); return "no option to pick on this database"; }
      await page.getByRole("option").nth(i).click(); await page.waitForTimeout(300);
      const shows = (await t.innerText()).trim();
      await page.keyboard.press("Escape");
      expect(!/c[a-z0-9]{20,}/.test(shows) && shows.includes(opts[i].trim().slice(0, 10)), `shows "${shows}"`);
      return true;
    });
  }
};

flows.font = async () => {
  await rec.step("Body text renders in Geist", async () => {
    await go("/");
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(/geist/i.test(family), family);
    return true;
  });
};

flows.phone = async () => {
  await page.setViewportSize({ width: 400, height: 860 });
  for (const [label, u, opener] of [["New Lead form", "/leads/new", null], ["Task dialog", "/tasks", /New task/i]]) {
    await rec.step(`${label} at 400 px: no sideways scroll; form controls ≥ 44 px`, async () => {
      await go(u);
      if (opener) { await page.getByRole("button", { name: opener }).first().click(); await page.waitForTimeout(500); }
      const m = await page.evaluate((inDialog) => {
        const root = inDialog ? document.querySelector("[role=dialog]") ?? document : document.querySelector("form") ?? document;
        const small = [...root.querySelectorAll("button, input:not([type=hidden]):not([type=checkbox]), [role=combobox], textarea")]
          .filter((e) => {
            if (e.getAttribute("aria-hidden") === "true" || e.closest("[aria-hidden=true]") || /hidden-input$/.test(e.id)) return false;
            const cs = getComputedStyle(e);
            if (cs.opacity === "0" || cs.visibility === "hidden") return false;
            const r = e.getBoundingClientRect();
            return r.width > 2 && r.height > 2 && r.height < 44;
          })
          .map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}:${Math.round(e.getBoundingClientRect().height)}${e.getAttribute("aria-label") ? `(${e.getAttribute("aria-label")})` : e.innerText ? `(${e.innerText.trim().slice(0, 20)})` : ""}`);
        return { sw: document.documentElement.scrollWidth, small };
      }, Boolean(opener));
      expect(m.sw <= 401, `scrolls sideways (${m.sw})`);
      expect(m.small.length === 0, `${m.small.length} under 44 px: ${m.small.slice(0, 6).join(", ")}`);
      return true;
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};

flows.lists = async () => {
  await rec.step("Jobs: clicking Contract sorts high to low, keeps it in the URL, and the rows follow", async () => {
    await go("/jobs?scope=all&closed=1");
    await page.getByRole("button", { name: /^Contract/ }).click();
    await page.waitForURL(/sort=contract/, { timeout: 10000 });
    await page.waitForTimeout(1500);
    expect(/dir=desc/.test(page.url()), `url ${page.url()}`);
    const amounts = await page.$$eval("table tbody tr td:nth-child(7)", (tds) => tds.map((td) => Number((td.textContent || "").replace(/[^0-9.]/g, "").replace(/\.$/, ""))));
    expect(amounts.length > 1, `only ${amounts.length} rows`);
    for (let i = 1; i < amounts.length; i++) expect(amounts[i - 1] >= amounts[i], `not descending: ${amounts.join(", ")}`);
    expect((await page.getByRole("columnheader", { name: /Contract/ }).getAttribute("aria-sort")) === "descending", "aria-sort missing");
    return `${amounts.length} rows, ${amounts[0]} → ${amounts.at(-1)}`;
  });
  await rec.step("Jobs: reloading the sorted URL keeps the order; a bad sort key falls back", async () => {
    await go("/jobs?scope=all&closed=1&sort=contract&dir=asc");
    expect((await page.getByRole("columnheader", { name: /Contract/ }).getAttribute("aria-sort")) === "ascending", "sort not restored from the URL");
    const r = await api("GET", "/api/jobs?scope=all&sort=passwordHash&dir=asc");
    expect(r.status === 200, `bad key answered ${r.status}`);
    return true;
  });
  await rec.step("Leads and Tasks sort from the URL / control", async () => {
    await go("/leads?scope=all&sort=name&dir=asc");
    expect((await page.getByRole("columnheader", { name: /Name/ }).getAttribute("aria-sort")) === "ascending", "leads sort not shown");
    const t = await api("GET", "/api/tasks?sort=priority&dir=desc");
    expect(t.status === 200 && Array.isArray(t.body), `tasks ${t.status}`);
    const rank = { URGENT: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
    const ps = t.body.map((x) => rank[x.priority]);
    for (let i = 1; i < ps.length; i++) expect(ps[i - 1] >= ps[i], "tasks not by priority");
    return `${t.body.length} tasks`;
  });
  await rec.step("At 400 px the Jobs list is cards with a Sort picker, not a sideways table", async () => {
    await page.setViewportSize({ width: 400, height: 860 });
    try {
      await go("/jobs?scope=all&closed=1");
      const m = await page.evaluate(() => ({ cards: document.querySelectorAll("ul[aria-label=Jobs] > li").length, overflow: document.documentElement.scrollWidth > innerWidth + 1, sort: !!document.querySelector("#phone-sort") }));
      expect(m.cards > 0, "no cards");
      expect(!m.overflow, "sideways scroll");
      expect(m.sort, "no sort picker");
      return `${m.cards} cards`;
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
};

flows.overlays = async () => {
  const measure = () => page.evaluate(() => {
    const d = document.querySelector("[data-slot=dialog-content]");
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { size: d.getAttribute("data-size"), w: Math.round(r.width), h: Math.round(r.height), vh: innerHeight, vw: innerWidth, scrolls: getComputedStyle(d).overflowY };
  });
  const openNewTask = async () => {
    await go("/tasks");
    await page.getByRole("button", { name: /^New task/ }).first().click();
    await page.waitForSelector("[data-slot=dialog-content]", { timeout: 10000 });
    await page.waitForTimeout(400);
  };
  await rec.step("New task opens at the md size: 512 px on a desktop, scrolling inside the screen", async () => {
    await openNewTask();
    const m = await measure();
    expect(m && m.size === "md", `size ${m?.size}`);
    expect(m.w === 512, `width ${m.w}`);
    expect(m.h <= m.vh - 32 && m.scrolls === "auto", `height ${m.h} / ${m.vh}, overflow ${m.scrolls}`);
    await page.keyboard.press("Escape");
    return `${m.w}×${m.h}`;
  });
  await rec.step("At 400 px the same dialog is the phone's width less 1 rem a side", async () => {
    await page.setViewportSize({ width: 400, height: 760 });
    try {
      await openNewTask();
      const m = await measure();
      expect(m.w === m.vw - 32, `width ${m.w} of ${m.vw}`);
      expect(m.h <= m.vh - 32, `height ${m.h} of ${m.vh}`);
      await page.keyboard.press("Escape");
      return `${m.w}×${m.h}`;
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
  await rec.step("Pages moved onto PageHeader show one title each", async () => {
    const out = [];
    for (const path of ["/crew-submissions", "/reports/labor/payroll", "/admin/contract-templates"]) {
      await go(path);
      const n = await page.locator("h1").count();
      expect(n === 1, `${path}: ${n} h1`);
      out.push(`${path} ${await page.locator("h1").first().innerText()}`);
    }
    return out.join("; ");
  });
};

const ORDER = ["lead", "task", "taskvis", "files", "permit", "expense", "crewpay", "co", "log", "calendar", "vendor", "bulk", "pickers", "font", "phone", "lists", "overlays"];
for (const name of ORDER) {
  if (only && !only.test(name)) continue;
  rec.group = name;
  const e0 = pageErrors.length;
  await flows[name]();
  if (pageErrors.length > e0) await rec.step("no page errors or native dialogs", async () => { throw new Error(pageErrors.slice(e0).join(" | ")); });
}
writeState(state);
await browser.close();
process.exit(rec.finish() ? 1 : 0);
