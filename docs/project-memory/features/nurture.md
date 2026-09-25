# Customer nurture — automated follow-ups + company emails to open leads

_Built 2026-09-25 on the `nurture` branch (Stage 2 of the "quieter boards
/ my jobs / nurture" plan, `~/.claude/plans/when-a-lead-is-sprightly-scone.md`).
Richard: "on jobs that are not won or lost, follow-up prompt emails so the
jobs are being touched until a decision is made … in between, emails
about the company, tips and tricks, relevant but not salesy."_

## What it does

Every open lead with an email address is **enrolled** by the morning run
and receives, from the assigned rep's name with reply-to the rep:

- **Follow-ups** ("checking in") on day 2, 7, 14, 30 after the *anchor*,
  then every 30 days. The anchor is the latest of lead created, stage
  changed, estimate sent, contract sent — each of which **resets the step**
  — or a personal touch (call / SMS / email logged by a person, an inbound
  reply, a tracked-link click), which **restarts the clock but keeps the
  step**. A follow-up is **skipped** (step advances, nothing sent) when the
  rep touched the lead within 3 days.
- **Nurture pieces** (who we are, what to expect, permits, hurricane prep,
  maintenance checks, paying for a bigger project, warranty, referral) on
  day 4, 10, 21 after enrolment, then every 30 days offset 15 days from the
  monthly follow-up. Sent in library order, **never twice to the same
  lead**; when the library is exhausted nurture pauses for that lead until
  a new piece is added. The nurture clock is never re-anchored.
- Never two automated emails within 48 h; a follow-up wins a collision and
  the nurture piece is pushed. Weekdays only, 08:00–11:00
  America/New_York, all editable in **Admin → Customer Nurture → Cadence**.
- **Stops** on Won, Lost, opt-out, or the email being removed. **Pauses**
  in excluded stages (On Hold by default) and resumes on the next move;
  a manual pause never auto-resumes. Three straight delivery failures
  pause with `delivery_failures`.
- **The rep is prompted** with an ordinary task (`nurture.personal-touch`,
  key `lead:NURTURE_TOUCH:{leadId}`, MEDIUM, due in 2 business days,
  assigned to the rep) after 10 quiet days, and once when the scripted
  steps run out. Logging any communication closes it.

Automated sends are `Communication` rows with `provider "nurture"` and
`createdByUserId null`, plus an `ActivityLog EMAIL_LOGGED` entry
("Automated follow-up: …"). They **never move `lastContactAt`** — that
field means a person touched the lead.

## Gates and operator switches

| Switch | Where | Default |
|---|---|---|
| `NURTURE_ENABLED` | env (`/etc/knuco/env`) | `0` |
| `NurtureSettings.enabled` | Admin → Customer Nurture → Cadence | off (seed) |
| `NURTURE_MAX_PER_RUN` | env | `50` |

A live run needs **both** gates and a configured email provider. A **dry
run** (`?dryRun=1`, or "Preview today's run" on the Queue tab) plans
everything — including leads it would enrol that same run — with the
gates off, so a day can be inspected before anything is switched on.

**Operator order:** SPF for `knuconstruction.com` → seed on prod → add the
cron line → dry run with Richard → `NURTURE_ENABLED=1` (+ restart) → tick
"Sending switched on" → first live day with `NURTURE_MAX_PER_RUN=10`.

```bash
# prod seed (idempotent; settings create-only; content by seedKey, never overwrites an edited row)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-nurture.ts"'
# droplet: /home/knuco/crm-cron/nurture.sh = copy of task-reminders.sh → POST /api/cron/nurture
# crontab: 15 13 * * 1-5   (9:15 EDT / 8:15 EST — inside the 08–11 window either side of the clock change)
```

## Shape

- Schema (migration `20261004120000_lead_nurture`): `NurtureSettings`
  (singleton `default`), `NurtureContent` (kind FOLLOW_UP|NURTURE, step,
  `seedKey @unique`, `sentCount`, `editedAt`), `LeadNurtureState` (one per
  lead: status, anchor, steps, next dates, last dates, prompt markers),
  `LeadNurtureSend` (`@@unique([leadId, slotKey])` = one send per kind per
  local day = idempotency; SENT|FAILED|SKIPPED).
- Pure logic: `src/lib/nurture/time.ts` (DST-safe window / weekday /
  slot-key maths on `@date-fns/tz`), `plan.ts` (`decideAction`,
  `schedule`, `stateAfterSend`, `stateAfterReanchor`, `initialState`,
  `shouldPromptRep`), `src/lib/validators/nurture.ts`.
- Runner `src/lib/nurture/run.ts` → `runNurtureTick(now, {dryRun, limit})`:
  gates → enrol (anchor from created / stage history / SENT estimate /
  contract sent / personal Communication) → reconcile every state (stop /
  pause / resume; stopping cancels the prompt task) → sync touches from
  Communications written without a hook → due states, capped, same
  address once per run → act (send row first, P2002 = already ran today;
  `renderLeadEmail({includeUnsubscribe: true})`; on success one
  transaction: Communication + send SENT + ActivityLog + `sentCount++` +
  state advance; on failure the row is FAILED and tomorrow retries under a
  new slot) → rep prompts (`ensureAutoTask`) → `reportDelivery("cron.nurture")`.
- Hooks `src/lib/nurture/hooks.ts`, all best-effort: stage + bulk-stage,
  tracked-link MARK_*, `POST /api/leads/[id]/communications`,
  `logInboundCommunication`, template-estimate SENT, `sendContract`,
  unsubscribe. `setNurtureStatus(leadId, pause|resume|stop|enrol, actor)`.
- Routes: `POST /api/cron/nurture` (`requireCronSecret`; `?dryRun=1`,
  `?limit=`; 503 without email unless dry), `/api/admin/nurture/settings`
  (GET; PUT recomputes every ACTIVE schedule, audited), `/content`
  (GET/POST/PUT reorder), `/content/[id]` (PUT sets `editedAt`; DELETE 403
  once sent), `/content/[id]/preview` (`?send=1` = `[TEST]` to me; id
  `draft` for unsaved text), `/queue`, `/sends`, `/preview-run`;
  `/api/leads/[id]/nurture` GET + POST `{action}` incl. `touch` (logs a
  Communication + ActivityLog + `lastContactAt`, then re-anchors).
- Roles: `canManageNurture` ADMIN; `canViewNurture` ADMIN, MANAGER;
  `canActOnLeadNurture` ADMIN, MANAGER, SALES_REP, OFFICE_STAFF.
- UI: Admin → **Customer Nurture** (`/admin/nurture`: Cadence / Library /
  Queue / Log, status banner with both gates + provider), lead detail
  **Automated follow-up** card (`components/leads/nurture-card.tsx`: next
  follow-up + subject, next nurture + subject, last automated, last
  personal, last 3 sends, Log a touch / Pause / Resume / Stop / Enrol).
- Seeds: `prisma/seeds/nurture/content.ts` (4 follow-ups, 8 nurture
  drafts for Richard to edit) via `prisma/seed-nurture.ts`, also called
  from `prisma/seed.ts`.
- The old `FollowUpRule` engine and its launchd `scripts/follow-up-tick.sh`
  are untouched and unrelated.

## Dev QA (2026-09-25)

Headless run with the SSO bypass: five QA leads (backdated, one On Hold,
two sharing an address, one to be opted out). Dry run planned the same
rows the live run then acted on; the live run enrolled 5, sent the day-2
follow-up from the rep with reply-to the rep, deferred the shared
address, paused the On Hold lead, wrote Communication (`nurture`,
external id) + ActivityLog + `sentCount`, advanced the state, left
`lastContactAt` null; a second run the same day sent nothing ("slot
already used today"); unsubscribe → `STOPPED opted_out`; a logged call
re-anchored keeping the step; the `touch` action, pause/resume/stop/enrol,
Won → `STOPPED won`, On Hold → Negotiation → ACTIVE all behaved; failure
path wrote FAILED rows, left the state alone and raised the
`EmailDelivery` audit. Settings PUT validation 400 on end ≤ start. QA rows
purged; dev settings restored (08–11, off).

**Found and fixed:** MailerSend rejects `List-Unsubscribe` /
`List-Unsubscribe-Post` headers on the current plan (422 "requires a
Professional plan") — the runner sends no custom headers; the body
carries the unsubscribe link. The dry run originally ignored leads it
would enrol that same run — it now plans them in memory.
