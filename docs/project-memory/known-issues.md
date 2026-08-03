# Known Issues / Technical Debt — KNU Construction CRM

_Updated 2026-08-03._

## Open — needs a decision or action

- 🔴 **MailerSend is on a TRIAL plan and is refusing recipients.** A live run
  of the task-reminders cron on 2026-08-03 returned
  `422 … trial account unique recipients limit #MS42225` for 2 of 4 people —
  they simply did not get their email. **This caps every outbound email the
  CRM sends**, not just task mail: estimates, change orders, payroll and
  follow-ups are all on the same account, and this limit predates the task
  module, which only made it visible. The code is behaving correctly (it
  raises, logs, and records `EMAIL_FAILED` on the task timeline). **Fix is
  commercial, not technical: upgrade the MailerSend plan.** Until then, assume
  any given recipient may silently not receive CRM mail.
- **Task reminder cron is scheduled but half its sends fail** for the reason
  above. `30 11 * * 1-5` (7:30am ET weekdays) in the `knuco` user's crontab →
  `/home/knuco/crm-cron/task-reminders.sh`, logging to
  `task-reminders.log` next to it. Expect a daily pair of MailerSend 422s in
  the journal until the plan is upgraded.
- **`PHONE_ROUTING_API_KEY` is unset in `/etc/knuco/env`**, so
  `/api/integrations/phone-routing/lead` returns 503 (`503` = operator
  misconfiguration, `401` = bad caller — deliberate split). The route is
  deployed and correct; the integration is inert until the key is set.
  Optionally also `PHONE_ROUTING_SYSTEM_USER_ID` to pin attribution;
  otherwise it falls back to the first active ADMIN.
- **Old domain still serves a 302, not a 301.** Deliberate, for the cutover
  bake-in — browsers cache 301s hard and it is painful to walk back. SSO is
  now proven (2026-08-03), but **the decision was to keep baking**: one
  verified login is not a week of clean traffic and the 302 costs nothing.
  Promote when the old host has gone quiet. The change is an nginx vhost
  edit on knuco-droplet, **not** a code deploy — nothing in this repo
  encodes the redirect. Whatever replaces it must preserve path + query and
  keep the `/api/integrations/` **proxy** exemption (see POST-through-302
  below).

## Dead code from the SSO cutover

Left in place deliberately rather than widening an auth change's blast
radius. Safe to remove in a dedicated pass:

- `src/lib/auth/lockout.ts`, `lockout-error.ts`, `password-policy.ts` (plus
  their tests) — only `password-policy` still has live callers, in
  `admin/users`.
- The password-setting path in `src/app/api/admin/users/route.ts` and
  `[id]/route.ts` (`bcrypt.hash`) — sets a password nothing can log in with.
  User creation properly belongs in the CareyOS admin now.
- `next-auth` / `@auth/prisma-adapter` in `package.json` — imported nowhere.

## Constraints / fragile areas

- **`everglade-droplet` runs a deploy script on SSH login.** An intended
  read-only inspection instead pulled main and rebuilt `buyback_app`
  (all layers CACHED, nothing shipped). Do not SSH there casually.
  knuco-droplet has a normal shell.
- **deploy.sh's laptop smoke test accepts only 200/307**, and the old domain
  now 302s. **Always deploy with
  `KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh`** or it fails at
  exit 19 *after* shipping.
- **POST through a 302 becomes a GET** and loses its body — this silently
  broke cc-allocator's expense postings during the cutover. Any new machine
  caller pointed at the old hostname must be proxied, not redirected
  (`/api/integrations/` already is).
- **Only the CRM vhost has the Cloudflare real-IP snippet.** Every other
  proxied app on the droplet still logs Cloudflare edge IPs.
- **`prisma migrate dev` wants to reset the dev DB** (a modified applied
  migration). Apply new migrations via `migrate diff` + `db execute` +
  `resolve` instead.
- **Lint baseline: 6 errors, 29 warnings**, all pre-existing and in files
  untouched this session (canvassing/properties, permits, personnel,
  door-knock-routes ×2, rich-text-editor). Mostly
  `react-hooks/set-state-in-effect` and `no-explicit-any`. Do not treat a
  clean lint as the bar until these are addressed.
- **3 Roofr orders sit in `REQUESTED`** (newest 2026-05-13) with the old
  callback URL baked in. Probably dead, but the `/api/integrations/` proxy
  exemption on the old domain keeps them working if they ever land.

## Resolved 2026-08-03 — task module defects

All five were live in production and all are now regression-tested in
`src/lib/validators/task.test.ts` and `src/lib/tasks/access.test.ts`.

- **Unassign and clear-due-date both 400'd.** `updateTaskSchema` inherited
  `z.string().optional()`, which rejects the explicit `null` the board sends.
- **Every save reset priority to MEDIUM.** `.partial()` does not strip
  `.default()`, so the create default leaked into each PATCH and the route
  spread it into the write — ticking an URGENT task complete downgraded it.
  Nothing errored; the value just changed. Defaults now live on create only,
  and the route copies fields across explicitly instead of spreading.
- **`completedAt` survived a reopen**, leaving a stale timestamp on an open
  task. Both it and `completedByUserId` are now cleared.
- **PATCH /api/tasks/[id] had no role check** while GET scoped SALES_REPs to
  their own rows. Read and write now share `lib/tasks/access.ts`.

## Resolved 2026-08-03

- **SSO happy path verified in production.** Frank (CREW_LEAD) signs in and
  lands on `/field` — the flagged edge case, the user with no fallback — and
  sign-out bounces to the CareyOS portal. The rollback window is closed;
  `0759ee8` stands. Residual gap: an office-role login was not separately
  exercised, but Frank's success covers the same cookie exchange, portal
  call and grant→role mapping, so this is not tracked as a risk.
- **jgarcia stays ADMIN — decided, not drifted.** His portal grant outranks
  his pre-cutover CRM role (MANAGER) and his next login syncs the CRM row up
  to ADMIN. Confirmed intended. No action; recorded so a future reader does
  not "fix" it back to MANAGER.

## Resolved 2026-07-23

- **Unsubscribe links never worked.** `/api/email/unsubscribe` was missing
  from the middleware allowlist, so recipients — and Gmail's
  `List-Unsubscribe-Post` — were 307'd to `/login` before the route ran.
  Pre-existing and silent. Fixed + regression-tested.
- **cc-allocator expense postings** broken by POST-through-302 during the
  cutover; `CRM_BASE_URL` repointed and verified.
- **Frank's `FIELD` grant** orphaned by the appRoles change → `CREW_LEAD`.
- **jgarcia identity mismatch** would have orphaned 23 rows across 9 tables;
  reconciled by an in-place email rename preserving `User.id`.
- **CareyOS registry** described a non-existent app (`/var/www/construction-crm`,
  port 3116, pm2).
