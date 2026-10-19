# Construction CRM — UX and Navigation Audit (2026-10-19)

## 1. Method

- **Page sweep (headless Chromium, dev):** 37 main pages at 1440 px and
  400 px, as five roles (ADMIN, SALES_REP, MANAGER, OFFICE_STAFF, CREW_LEAD).
  That is 370 page loads, each checked for HTTP status, page errors, console
  errors, horizontal overflow and load time.
- **Code read** of the sidebar, dashboard, attention rows, list pages and job
  page.
- **Prod usage counts** (read-only) to see what people actually do.
- **Click counts** were traced from the UI code, not timed with real users.
  Dev load times are first-compile times, so they over-state prod.

## 2. What the sweep found

| Role | Page loads | Flagged | Findings |
|---|---|---|---|
| ADMIN (owner) | 74 | 0 | No page errors, no failed loads, no overflow at 400 px |
| MANAGER (estimator / PM) | 74 | 0 | Clean |
| OFFICE_STAFF (permit coordinator) | 74 | 2 | `/referrals` (not in their sidebar) crashes: `referrals.filter is not a function` after a 403 |
| SALES_REP | 74 | 12 | Crash with a TypeError after a 403: `/referrals`, `/personnel`, `/field-logs` (reached by URL only; hidden in the sidebar). `/vendors` shows a 403 error; `/reports` and `/partners/analytics` log a 403 for one panel |
| CREW_LEAD | 74 | 0 | Every office URL redirects to `/field`, as designed |

**Takeaways:**
- **Stable at every width.** No page overflows on a phone.
- **When a page's data request is refused, some pages break instead of
  saying so.** These are the raw `fetch` calls without `fetchJson` (204 of
  them in 56 files).
- **`/reports` is in every role's sidebar** but part of it is refused for
  SALES_REP.

## 3. Role by role

### Owner / administrator
- **Lands on:** the dashboard. Needs Attention (20 role-aware rows) →
  Today / My tasks → Workflow health → sales tiles and charts.
- **Finds in one place:** overdue tasks, permits waiting or expiring, overdue
  follow-ups, logs to review, deposits missing, contracts awaiting signature.
- **Cannot see:**
  - pipeline value (`estimatedJobValue` is never summed)
  - outstanding estimates (no list across leads)
  - jobs over budget (Collections only, office roles)
  - delayed jobs (health is shown per job only)
  - who is behind (one overdue total; prod has 32 overdue on one person)
- **Sidebar:** 45 entries in 6 groups, 17 of them admin. The 2026-09-25 UX
  stage had cut it to 11.

### Sales representative
- **Follow-ups:** the dashboard row "Overdue follow-ups" (their own leads)
  plus `/attention/overdue-follow-ups`.
- **`/leads`:** no follow-up filter or sort; overdue rows are only tinted red.
- **Logging a call does not move the follow-up date.** Ruled 2026-10-19:
  keep it. So the overdue list shrinks only when the date is edited; worth
  saying in the UI ("set the next follow-up").
- **Estimating:** two different estimate builders (roofing form vs sectioned
  template). The choice depends on the service.
- **Clicks to "log a call and set the next follow-up":** lead → Activity →
  Log → save → Edit lead → date → save. **About 7.**
- **Duplicate warning:** a toast after create. Phone formats are not
  matched.

### Estimator
- Data is not retyped from the lead (name and address flow into PDFs).
- **Data is retyped** from the Roofr measurement into a roofing estimate,
  and from the estimate total into the job price.
- **Line field labelled "Unit price"** is treated as cost and then marked
  up. That invites double margin.
- **No price book** outside roofing. **No plumbing or commercial template.**
- **Clicks to a roofing estimate from a Roofr report:** lead → Roofr →
  upload → (note squares) → Estimates → New roofing → type squares, pitch,
  material lump, fees → save. **About 12 plus typing.**

### Project manager
- **The job page:** Overview first, plus 19 more tabs grouped as Money ·
  Field · Permits · Tasks · Files · History. Every outstanding task on the
  job is in the Tasks tab (All / Manual / Workflow), **except** tasks of a
  linked violation case.
- **Missing:**
  - Gantt
  - crew durations
  - punch items
  - warranty record
  - project contacts
  - a customer-facing view
- **The Overview leaves out** field issues, crews, budget variance and the
  projected finish.

### Permit coordinator
- **Three places show "permits needing attention":**
  - dashboard attention rows (5 permit rows)
  - Permit Center "At risk" tile
  - Permit Center Aging tab

  They use **three different "late" rules** (7 / 14 days, 14 days, 30 days
  or the jurisdiction target). Failed inspections are missing from the
  Center.
- **Three places edit a permit:** the job tab, the Center drawer and
  `/permits/[id]`.
- **Strong where it matters:** correction letters read for you, forms
  filled, the frozen package with hashes.

## 4. The owner's 60-second questions

| Question | Today | Where |
|---|---|---|
| New leads today | Partial | `/leads` date filter; no tile |
| Leads not contacted | Partial | No "never contacted" view (prod: 19) |
| Estimates outstanding | **No** | Per lead only |
| Proposals needing follow-up | Partial | Overdue follow-ups; contracts awaiting signature (never used) |
| Active projects | Yes | `/jobs`, Workflow health |
| Projects behind schedule | Partial | Steps overdue / blocked; job health per job only |
| Permits delaying projects | Partial | Attention rows; not tied to the job schedule |
| Employees with overdue tasks | Partial | One total; no per-person view |
| Outstanding sub bids | **No** | Not a feature |
| Jobs over budget | Partial | Collections red cell; office roles |
| Pipeline value | **No** | Never summed |
| Expected gross profit (active) | Partial | Per job on Collections; no total |
| What needs intervention today | Yes | Needs Attention |

**Score: 2 yes, 8 partial, 3 no.** MVP 2 (command center) turns all 13 into
one tile or row each.

## 5. Specific UX questions

| Question | Answer |
|---|---|
| Owner finds urgent issues < 60 s? | For tasks and permits, yes. For money and sales, no (§4) |
| Sales rep sees who needs follow-up? | Yes, on the dashboard. Not on `/leads` |
| Estimator avoids retyping? | Lead data yes; measurements and totals no |
| PM sees every outstanding task on a job? | Yes, except violation-case tasks |
| Coordinator sees all permits needing attention? | Split across three views with different rules |
| Documents and communication history easy to reach? | Files yes (preview, missing, upload again). Communication history is thin (prod: 4 rows) because email and SMS are not logged from outside the CRM |
| Leads / opportunities / estimates / jobs used consistently? | Mostly. A GC bid is a "lead" of kind GC_BID and an estimate exists in two systems. The glossary (stage 4 UX) helps; the two estimate builders confuse |

## 6. Recommendations (simplify first)

1. **Cut the sidebar to about 15 entries.**
   - Admin becomes one entry with its own index page.
   - Field and money groups collapse for roles that do not use them.
   - Response Times and Referrals are hidden until used.
2. **One "worklist" per role on the dashboard.** The attention rows already
   are this. Add the missing owner rows (MVP 2) and a per-person overdue row
   (MVP 3) rather than new pages.
3. **`/leads` call list:** a "Follow-up due" filter and sort, next to Mine /
   All.
4. **One estimate builder.** Retire the roofing form for new work. Label the
   line field "Unit cost". Generate the roofing section from the measurement.
5. **One permit edit surface** (the record). One "needs attention" rule set
   shared by the dashboard rows and the Permit Center.
6. **Fail loudly, not by crashing.** Pages reached without access show "Not
   available for your role". Convert the 204 raw `fetch` calls with
   `fetchJson` as files are touched.
7. **Hide idle depth** behind an "advanced" switch: permit lessons, the
   flat-form path, violation hearings and inspections as filters.
8. **Say what the system will not do for you.** For example, "logging a call
   does not change the follow-up date".

## 7. Mobile

- **Office pages:** no horizontal overflow at 400 px on any swept page for
  any role. Tab strips wrap.
- **Field mode** (`/field`, `/field/day`): gloves-friendly action rows,
  photo capture, checklist. Prod shows 1 daily log in 30 days, so the limit
  is adoption, not layout.
- **No native app.** No offline mode.
