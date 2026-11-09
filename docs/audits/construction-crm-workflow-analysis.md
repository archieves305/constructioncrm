# Workflow analysis — KNU Construction CRM (web)

Checkpoint 2, 2026-11-09. What each everyday flow asks of the person doing it, where it trips, and what would make it shorter. Results and evidence for each flow are in the [functional audit](construction-crm-functional-audit.md); defect ids refer to the [defect register](construction-crm-defect-register.md).

The order follows how often the work happens: tasks and notes first, then money, then the job's record. The Nov 8 usage measurements rank them the same way.

## 1. Tasks (highest traffic)

**Today:** Tasks → New task (or `n`) → title → optional due / priority / assignee / job → Create. The sheet holds status (a dropdown), notes, schedule, files and the timeline.

**Where it trips**
- **A new task goes to nobody, and the page opens on "mine"** (D-12, browser-verified). Someone who creates a task with the defaults sees it vanish, so it looks as though the save failed. The calendar's default view hides it in the same way.
- **Completing from the sheet is a dropdown with five statuses.** Workflow rows already have a one-click "Done" with Undo; ordinary tasks don't.
- **Status, assignee and priority pickers have no accessible names** (axe button-name). A screen reader hears "button" and nothing else.

**Change:** default the assignee to the person creating the task when they open the dialog from a "mine" view, and say so in the dialog ("Assigned to you"). Give the sheet the same Done / Undo button the workflow rows have. Name the three pickers.

## 2. Notes and contact on a lead

**Today:** lead page → Activity → note box. Logging a contact does not move the next follow-up date (ruled 2026-10-19).

**Where it trips:** no defect found in this pass. The Call list (`/leads?callList=1`) is the right entry point but sits behind a toggle on the Leads page.

**Change:** none needed for function. Consider a "Call list" entry on the dashboard's sales rows.

## 3. Lead → estimate → Won → job

**Today:** New Lead (4 cards, about 20 fields, 5 required) → the lead's Estimates tab → build → mark sent → stage stepper → Won → the dialog preselects the sent estimate → the job is created at its price, with its cost frozen and budget lines made.

**Where it trips**
- The empty New Lead form is checked by the server, not in the browser: a 400 round trip before the errors show. It works, but slowly on a phone signal.
- The address lookup's suggestion list stays open over the next field until Escape.

**Change:** check the required fields in the browser (the form already uses react-hook-form, so this is adding the schema resolver). Close the suggestions when the field loses focus.

## 4. Money: expenses, approvals, change orders, crew payments

**Today:** Job → Money → Expenses → add (with receipt) → a rep's charge waits → Approve in the list. Change orders and crew payments live on Money → Change orders and Field → Labor.

**Where it trips**
- **Validation messages:** a negative amount reads "Too small: expected number to be >=0"; a zero-price change order or a bulk close with no reason reads "Validation failed" with the real reason dropped (D-13).
- **The change order's "Linked crew contract" shows the contract id after a pick and "__none" before** (D-06, browser-verified).
- **Crew pay sits under Field and change orders under Money.** Both are money owed to or by the crew, and people look for them in two places (recorded on 2026-10-02, when labor payments "went missing").

**Change:** fix the message path once in `fetchJson` (show the first field message) and the wording in the schemas. Pass `items` to the picker. Add a "Crew payments" link on Money → Overview pointing at Field → Labor (the Overview already links back the other way).

## 5. Permits, inspections and corrections

**Today:** Job → Permits → add → inspection → result. A FAIL raises the correction task on the job by itself, and the permit record holds documents, cycles and submissions.

**Where it trips**
- The permit page's title is the raw type code ("BUILDING"), and its 13 tabs wrap onto three rows on a phone (D-09).

**Change:** use the type's label, and make the tab list a horizontal scroller as on the job page.

## 6. Daily log and field

**Today:** the office daily-log day page, or Field → job → Daily. Write → submit → approve; approving twice is refused with a clear message.

**Where it trips**
- A day with no log shows loading placeholders forever instead of "No log for this day — start one" (D-03).
- A crew lead who opens another job's log or day gets a crash or an endless placeholder (D-01, D-04).

**Change:** one shared not-found / no-access state (the job and lead pages already have the pattern).

## 7. Calendar and clean-up

**Today:** keyboard and mouse drag both move a task (browser-verified with the keyboard). The overdue clean-up asks for confirmation with the count and the day.

**Where it trips:** only D-12 (unassigned work hidden by default). The clean-up panel is a good pattern to copy for other bulk actions.

## 8. Vendors, crew links, files

These work cleanly. Duplicate vendors are refused with a clear message, and the file preview opens in place. The crew link flow passed its full check.

## Patterns worth spreading

- **Confirmation that names the effect** ("Move 2 overdue tasks to 2026-11-20?") in place of the 25 native `confirm()` calls.
- **A refusal that says why** ("Only Admin, Manager or Accounting can approve job charges."), as several routes already do; it should replace the bare "Forbidden" on change-order decisions and bulk tasks.
- **Done with Undo** from the workflow rows, on every task.
