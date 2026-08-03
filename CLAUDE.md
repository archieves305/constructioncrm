@AGENTS.md

# Claude Project Memory — KNU Construction CRM

_Concise by design. Full detail lives in [docs/project-memory/](docs/project-memory/)._

## 1. Project Purpose

CRM for KNU Construction: leads → estimates → jobs → invoicing in one
pipeline, plus a field-labour module (daily logs, crew hours, payroll) and
canvassing. Receives expense postings from cc-allocator. Part of the CareyOS
app fleet.

## 2. Current System Architecture

Next.js **16.2.3** (App Router) + Prisma/PostgreSQL, on knuco-droplet
(161.35.0.183) at `/opt/knuco`, port 4000, under the **systemd unit
`knuco`** — the only fleet app not on pm2. Public host
**`https://crm.careyos.com`** (Cloudflare-proxied). Env at `/etc/knuco/env`.

The same droplet runs CareyOS (`/var/www/careyos`, pm2, port 3000) and ~14
sibling `*.careyos.com` apps.

Auth is **CareyOS SSO** — see §9 and
[features/careyos-sso.md](docs/project-memory/features/careyos-sso.md).
Details: [architecture.md](docs/project-memory/architecture.md).

## 3. Active Workstreams

1. 🔴 **Job-costing check-and-balance.** The write gate shipped; the
   structural work has not. Next: a `PENDING` charge that does not move
   `contractAmount`/`balanceDue` until approved, then reconciliation against
   cc-allocator. **12 candidate duplicate charges ($9,166.20) need a human to
   confirm** — see [known-issues.md](docs/project-memory/known-issues.md).
2. Confirm `field-log-digest` self-healed on its next 7:00am run — it had
   been failing for all four `@calibertrust.com` users under the old
   MailerSend cap, which is now lifted.
3. Add the SPF record for `knuconstruction.com` (see §5).
3. Set `PHONE_ROUTING_API_KEY` to activate the phone-routing integration.
4. Dead-code cleanup from the auth swap.
5. Promote the old domain's 302 → 301 — **deliberately parked**, not
   blocked (see §5).

The SSO cutover is **done and verified**; jgarcia's role is **decided**.

## 4. Session Log (latest — full history in [session-history.md](docs/project-memory/session-history.md))

### 2026-08-03 — Task collaboration (built, NOT deployed)

Assignment/completion email on the existing branded shell, notes, a per-task
activity trail, watchers, @mentions, BLOCKED status, morning reminder digest.
New: `src/lib/tasks/*`, `src/components/tasks/*`, notes/watchers routes,
`/api/cron/task-reminders`, `/field/tasks/[taskId]`, migration
`20260803120000_task_collaboration`.

**Five pre-existing defects fixed.** Unassign and clear-due-date both 400'd;
`completedAt` survived a reopen; PATCH had no role check; and — worst —
`.partial()` does not strip `.default()`, so **every save silently reset
priority to MEDIUM**, downgrading URGENT tasks on completion. Details in
[known-issues.md](docs/project-memory/known-issues.md).

329/329 tests, typecheck and build clean, lint one warning better than
baseline. No browser QA yet.

### 2026-08-03 — SSO verified; two decisions closed

No code changes. Frank (CREW_LEAD) signs in and lands on `/field` — the one
load-bearing unknown from the cutover — and sign-out bounces to the portal.
The rollback window is closed; `0759ee8` stands. jgarcia **stays ADMIN**
(confirmed intended, not drift). The old domain **holds at 302** — one
verified login is not a week of clean traffic.

### 2026-07-23 — Domain cutover + CareyOS SSO (deployed)

`69a5c3c..0759ee8`, 7 commits, 43 files, +1592/−674. Two app deploys plus a
portal deploy.

- Moved `crm.knuconstruction.com` → **`crm.careyos.com`**. Old host 302s,
  preserving path + query so emailed `/co` and `/action` links survive;
  `/api/integrations/` is **proxied not redirected** (POST→GET through a 302
  loses the body — this silently broke cc-allocator mid-cutover).
- Discovered both domains were **already on the same droplet**, cancelling
  the planned host move (containerise, DB restore, downtime window).
- Split `APP_BASE_URL` out of `NEXTAUTH_URL` so the public host is one env
  var, decoupled from auth.
- Added the Cloudflare **real-IP** snippet — the host is now proxied, so
  without it every client looks like an edge IP.
- Replaced NextAuth credentials with **CareyOS SSO**. `helpers.ts` was the
  seam, so ~140 route handlers needed no edits.
- Portal repo: `construction-crm` appRoles → the CRM's real seven; registry
  entry corrected (it described a non-existent app).
- **Fixed: unsubscribe links never worked** — `/api/email/unsubscribe` was
  missing from the middleware allowlist, so recipients were 307'd to
  `/login`. Pre-existing and silent.
- Data: Frank's grant `FIELD`→`CREW_LEAD`; jgarcia's CRM email renamed in
  place, preserving 23 referencing rows.

## 5. Known Issues / Technical Debt

Full list: [known-issues.md](docs/project-memory/known-issues.md).

- **SPF is unset on `knuconstruction.com` in MailerSend** (`dkim: true`,
  `spf: false`). Delivering fine today, but strict receivers may spam-folder
  it. Next most likely cause of "never arrived" reports now that the
  recipient cap is resolved.
- Delivery failures now escalate through `lib/email/delivery-report.ts`
  (ERROR log with marker `EMAIL_DELIVERY_FAILURE`, an `EmailDelivery` audit
  row, and a best-effort ops email). Read history at
  `GET /api/admin/email-health` — the channel that still answers when email
  itself is what is broken. Optional `OPS_ALERT_EMAIL`, else oldest active
  ADMIN.
- `PHONE_ROUTING_API_KEY` unset → that endpoint 503s.
- Old domain still 302, not 301 — deliberate, and **still deliberate after
  SSO was proven**. Promote when the old host goes quiet. It is an nginx
  vhost edit on the droplet, not a code deploy; must preserve path + query
  and the `/api/integrations/` proxy exemption.
- Dead code: `lockout*`, `password-policy`, `admin/users` password path,
  `next-auth` in package.json.
- **Lint baseline: 6 errors / 29 warnings**, all pre-existing.

## 6. Resume Instructions

```bash
git log --oneline -8            # 0759ee8 is the SSO deploy
npm run test && npm run typecheck
```
Read `docs/project-memory/known-issues.md` first. The SSO verification gap
that headed it is closed; what remains is config and cleanup.

## 7. Commands

```bash
npm run dev            # next dev -p 4000
npm run test           # vitest run
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (NOT `next lint` — removed in Next 16)
npm run build

# Deploy — the env override is REQUIRED. The smoke test accepts only
# 200/307 and the old domain now 302s, so a bare ./deploy.sh fails at
# exit 19 *after* shipping.
KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes
KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --dry-run
```

Prod one-offs: run as user `knuco` on knuco-droplet with `/etc/knuco/env`
loaded. Migrations: `prisma migrate dev` wants to reset the dev DB — use
`migrate diff` + `db execute` + `resolve`.

## 8. Environment Variables (names only — never store values)

Required: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.

Public host: **`APP_BASE_URL`** (falls back to `NEXTAUTH_URL`; every
outbound link is built from it).

SSO: **`CAREYOS_SSO_URL`** (default `https://app.careyos.com`),
**`CAREYOS_APP_ID`** (default `construction-crm`),
`CAREYOS_SSO_DEV_BYPASS` / `CAREYOS_DEV_EMAIL` / `CAREYOS_DEV_ROLE` —
**local dev only; the app refuses to boot if the bypass is set under
`NODE_ENV=production`.**

Optional (feature 503s when unset): `TWILIO_*`, `OUTLOOK_*`,
`MAILERSEND_API_KEY`, `EMAIL_FROM`, `OPS_ALERT_EMAIL`, `CRON_SECRET`,
`CC_ALLOCATOR_API_KEY`,
`PHONE_ROUTING_API_KEY`, `PHONE_ROUTING_SYSTEM_USER_ID`, `ZAPIER_*`,
`FIELD_ENCRYPTION_KEYS` (SSNs — without it, encrypted rows are unreadable),
`ZYLOW_API_KEY`, `ZYLOW_API_BASE`.

## 9. Important Product / Business Rules

- **CareyOS is the identity provider.** New users are created in the
  CareyOS admin, not the CRM. Identity is keyed on **email** — a mismatch
  between portal and CRM addresses mints a second user and orphans records.
- Grants apply on the next page load, no re-login. A portal ADMIN with no
  explicit grant implicitly gets `appRoles[0]` (ADMIN).
- A CRM `User` with `isActive: false` is denied even if the portal allows.
- **Public, session-free paths** — never put these behind auth:
  `/co/*`, `/action/*`, `/api/co/*`, `/api/track/*`,
  `/api/email/unsubscribe`, `/api/integrations/*` (bearer), `/api/cron/*`
  (`CRON_SECRET`). Covered by `src/middleware.test.ts`.
- Integration convention: **503** when a server key is unset (operator
  error), **401** for a bad caller.
- CREW_LEADs are confined to `/field`; the office shell is not for them.
- **Job costs are gated by role + the `canEnterJobCosts` grant** —
  ADMIN/MANAGER/OFFICE_STAFF implicitly, anyone else by explicit grant. Use
  **explicit role lists, never `hasMinRole`**, for anything financial:
  `ROLE_HIERARCHY` ranks SALES_REP above OFFICE_STAFF (Accounting).
- **cc-allocator owns money that actually moved**; the CRM owns job costing
  including costs that have not moved yet. Expenses with an `externalId` are
  cc-allocator's record — ADMIN-only to delete here, and better fixed there.

## 10. Next Prompt

> The CareyOS SSO cutover is verified and settled — don't re-litigate it.
> Do the dead-code cleanup from the auth swap: remove `src/lib/auth/lockout.ts`,
> `lockout-error.ts`, `password-policy.ts` and their tests, drop the
> `bcrypt.hash` password-setting path from `src/app/api/admin/users/route.ts`
> and `[id]/route.ts` (user creation belongs in the CareyOS admin now), and
> pull `next-auth` + `@auth/prisma-adapter` from `package.json`. Keep the
> lint baseline at 6 errors / 29 warnings or better; `npm run test &&
> npm run typecheck` must stay green. Deploy with
> `KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes`.
