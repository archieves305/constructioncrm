# Session History — KNU Construction CRM

_Detailed, append-only log. Newest first. Concise summary in `/CLAUDE.md` §4._

---

## 2026-08-03 — Task collaboration: notification email, notes, history

Built out the Task module: branded email on assignment and completion, notes,
a per-task activity trail, watchers, @mentions, a BLOCKED status and a morning
reminder digest. **Deployed as `d12945e`** (BUILD_ID
`bckl0-luXQ4XIe0WqzwFl` → `F5tEnwV3x13sc-0OYUI2a`), migration applied, smoke
tests 307/307, clean journal. Reminder cron installed at `30 11 * * 1-5` then
**commented out the same day** — see the MailerSend finding below. Assignment,
completion and mention mail stayed live.

### 🔴 Found on the first live cron run: MailerSend is a TRIAL account

The first real invocation returned `{"tasks":5,"people":4,"sent":2,
"failures":2}` — MailerSend answered `422 … trial account unique recipients
limit #MS42225` for two people, who therefore got nothing. This is an account
limit, not a defect: the code raised, logged and recorded `EMAIL_FAILED` as
designed. **It caps every outbound email the CRM sends** — estimates, change
orders, payroll, follow-ups — and predates this work; the task module merely
exercised enough distinct recipients to expose it. Fix is commercial.

### Five pre-existing defects found and fixed

The first four surfaced while reading the module; the fifth while writing its
tests. All were live in production.

1. **Unassigning a task was broken.** The board sends `assignedUserId: null`,
   but `updateTaskSchema` used `z.string().optional()`, which rejects null →
   400 → a generic "Update failed" toast.
2. **Clearing a due date was broken**, same cause.
3. **`priority` was silently reset to MEDIUM on every save.** `.partial()` does
   not strip `.default()`, so the create schema's default landed in every PATCH
   and the route spread it into the write. **Ticking an URGENT task complete
   downgraded it to MEDIUM.** The most damaging of the five and the hardest to
   notice — nothing errors, the value just quietly changes.
4. **`completedAt` was never cleared on reopen** (`undefined` means "leave
   alone" in Prisma), so reopened tasks kept a stale completion timestamp.
5. **PATCH had no authorization.** GET scoped a SALES_REP to their own rows;
   PATCH checked only that a session existed, so any authenticated user could
   modify any task by id. Both sides now derive from `lib/tasks/access.ts`.

### Schema

`20260803120000_task_collaboration`, applied to dev via migrate diff + db
execute + resolve (verified with an empty diff before `resolve`).

- `TaskEvent` — one chronological feed carrying BOTH notes and system events.
  Single table so the timeline is one ordered read with no merge step; only
  `NOTE` rows are editable. `EMAIL_SENT` / `EMAIL_FAILED` rows make "was he
  actually told?" answerable in-product.
- `TaskWatcher`, `Task.completedByUserId` / `assignedAt` / `blockedReason`,
  `TaskStatus.BLOCKED`, `User.taskEmailsEnabled`.
- Backfill seeds a `CREATED` event per existing task — otherwise an older task
  opens to an empty timeline, which reads as lost history.

### Email

`lib/tasks/task-email.ts` renders bodies only and delegates the shell to the
existing `renderEmailLayout` + `getEmailBrand`, so task mail matches the
estimates and change orders the same people already receive. Tables and inline
CSS throughout. Assigned / completed / blocked / mention / reminder, each with
a plain-text alternate.

Dispatch is best-effort and runs in `after()` (Next 16, supported on a Node
server): the task write commits first, and a MailerSend outage can never turn
a successful assignment into a 500.

Suppression rules, all tested: muted, inactive, blank address, and "don't mail
someone about their own click". Completion is the deliberate exception — it
goes to assignor and assignee both, as specified. Links route by the
RECIPIENT's role, so crew leads get `/field/tasks/[id]` and office users get
`/tasks?task=[id]`; a new field-mode task page was added for the former.

### Mentions

Longest-match-at-position, not per-user first-match. The first implementation
had a real bug caught by its own test: Frank Ruiz's email local part is
`frank`, so "@Frank Delgado" matched both men. A handle claimed by two people
now resolves to nobody — with two Franks, "@Frank" mails neither, and the
composer's autocomplete is what steers the author to a full name.

### Verification

329/329 vitest (was 328/36 files; 6 new suites, 58 new tests). Typecheck
clean. Production build compiles; `/tasks` and `/field/tasks/[taskId]` are
both dynamic. **Lint 6 errors / 28 warnings — one warning better than the
6/29 baseline** (an unused `format` import went away). No manual QA in a
browser yet.

---

## 2026-08-03 — SSO happy path verified in production

Operator-confirmed. No code changes, no deploy.

- **Frank (CREW_LEAD) signs in and lands on `/field`.** This was the one
  genuinely load-bearing unknown from the cutover — the user with no
  fallback if the grant→role mapping were wrong. It works.
- **Sign-out bounces to the CareyOS portal**, not a dead local `/login`.
- An office-role login (ADMIN/MANAGER/…) was not separately exercised.
  Frank passing exercises the whole chain — cookie exchange, portal call,
  grant→role mapping, CREW_LEAD confinement — so the residual gap is only
  the office shell's own redirect, the better-trodden of the two paths.
- **The rollback window is closed.** `0759ee8` stands. No migrations ever
  ran, so nothing needs unwinding either way.

Decisions taken this session:

- **jgarcia stays ADMIN.** His portal grant (ADMIN) outranks his pre-cutover
  CRM role (MANAGER), so his next login syncs the CRM row up. Confirmed
  intended — a promotion, not an accident. No action needed.
- **The old domain holds at 302.** One verified login is not a week of clean
  traffic, and browsers cache 301s hard. Promote later, deliberately.

---

## 2026-07-23 — Domain cutover to crm.careyos.com + CareyOS SSO (deployed)

Moved the CRM onto the CareyOS fleet: new hostname, portal SSO, local
passwords retired. Seven commits, `69a5c3c..0759ee8`, 43 files,
+1592/−674. Two production deploys of this app plus one of the portal.

### Infrastructure discovery (corrected a wrong assumption)

Both domains were already on **the same droplet** — knuco-droplet
161.35.0.183. An earlier reading placed CareyOS on everglade-droplet; that
was wrong. Everglade's catch-all vhost answers any `Host` header, so a
`--resolve` probe returned 200 and looked like proof. Byte-identical
response bodies settled it: knuco is the CareyOS origin (74642B,
`<title>CareyOS — Internal Operating System</title>`), everglade serves
zylow (1691B). **Consequence: the planned host move — containerise,
Postgres dump/restore, uploads transfer, replace deploy.sh, downtime
window — was cancelled entirely.**

`crm.careyos.com` was already a Cloudflare record pointing at everglade,
returning 526 (everglade presents a `closers.zylow.net` cert).

⚠️ SSH to **everglade-droplet runs a deploy script on login** (ForceCommand
or equivalent). An intended read-only inspection instead fetched main and
rebuilt `buyback_app`. All layers were CACHED so nothing shipped, but do
not SSH there casually. knuco-droplet has a normal shell.

### Phase 1 — domain portability (b86fbbb)

`NEXTAUTH_URL` was doing two jobs: NextAuth's callback origin, and the
public host stamped into every outbound link. Split the second into
`APP_BASE_URL` (optional, falls back to `NEXTAUTH_URL`, trailing slash
stripped centrally). Eight call sites repointed: tracked links, unsubscribe,
`/co` portal, password reset, both field-log crons, Zapier roofr callback.
`deploy.sh` `PUBLIC_URL` → `${KNUCO_PUBLIC_URL:-…}`.

That last bit mattered immediately: deploy.sh's laptop smoke test accepts
only 200/307, and the old domain now 302s — an unmodified script would have
failed *after* shipping. Every deploy since runs
`KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh`.

### Phase 3 — the cutover itself

Executed old-domain-first so nothing broke mid-flight:

1. **nginx vhost** `crm.careyos.com` → `127.0.0.1:4000`, reusing the
   existing `/etc/ssl/cloudflare/careyos-origin.{pem,key}` (already covers
   `*.careyos.com`). Modeled on the `fuel.careyos.com` vhost.
2. **`/etc/nginx/snippets/cloudflare-real-ip.conf`** — CF v4/v6 ranges +
   `real_ip_header CF-Connecting-IP`. The old host was a direct A record;
   the new one is proxied, so without this every request arrives as a
   Cloudflare edge IP, poisoning `resolveTrackedLink`'s `ipAddress` and
   collapsing IP-keyed rate limiting into shared buckets. Verified working
   (real IPv6 in the access log). **The box had no CF real-IP config at
   all — the other proxied apps still log edge IPs.**
3. **Cloudflare DNS** repointed to 161.35.0.183 (Richard, dashboard — no
   API credentials exist on the droplet).
4. **`/etc/knuco/env`**: `NEXTAUTH_URL` + `APP_BASE_URL` →
   `https://crm.careyos.com`. Backup `env.bak-20260723-precutover`.
5. **Old domain → 302** preserving path and query, ACME path exempt so the
   LE cert keeps renewing. Backup `knuco.bak-20260723-precutover`.

**`/api/integrations/` on the old domain is proxied, not redirected.**
Machine callers POST there and Node's fetch downgrades POST→GET when
following a 302, silently dropping the body. This had already broken
cc-allocator's expense postings between the redirect going in and being
noticed. Zapier's Roofr callback bakes its URL in per order and 3 orders
sat in `REQUESTED`, so the exemption protects them too.

External callers swept: **cc-allocator** `CRM_BASE_URL` repointed +
restarted (verified 200 with real job data); **knu-phone-routing** has no
CRM references yet; **cron** — all four `/home/knuco/crm-cron/*.sh` hit
`127.0.0.1:4000` directly, unaffected; **Twilio** is outbound-only.

### Phase 2 — CareyOS SSO (0759ee8)

CareyOS (`app.careyos.com`, port 3000, `/var/www/careyos`) is its own IdP —
no third party. Two integration modes exist; being on `.careyos.com` put
the CRM in the simple one: forward the `careyos_session` cookie (scoped
`.careyos.com`) to `/api/sso/authorize`. **The redirect-handoff flow in the
portal's `docs/sso-external-domain.md` was written for the CRM and is now
unnecessary — doing the domain first avoided building and discarding it.**

- **`src/lib/sso.ts`** — introspection, `loginUrl()`, `logoutUrl()`. Fails
  closed on every path. We never hold `CAREYOS_SSO_SECRET`.
- **`src/lib/auth/helpers.ts` is the seam.** `getSession`/`requireSession`/
  `requireRole` kept signatures and shape, so **~140 route handlers and
  pages needed no edits**. Wrapped in `React.cache` — one introspection per
  request, not N. Find-or-creates the CRM `User` by email (anchor for FKs)
  and mirrors `appRole` onto `role_id`.
- **Middleware** dropped to a cookie-presence check (edge has no DB, no
  role). Role enforcement moved to the `(dashboard)`, `(dashboard)/admin`
  (new) and `(field)` layouts, resolved live — stronger than reading a role
  off a JWT valid until expiry.
- **Client**: `next-auth/react` → `src/lib/auth/session-client.tsx`,
  API-compatible so six consumers changed only an import. Backed by new
  `/api/me`. `signOut()` → `/api/auth/sign-out` → portal logout.
- **Removed**: `[...nextauth]` route, `auth/options.ts`, forgot/reset
  password pages and routes. `/login` is now a portal bounce that honours
  only relative `callbackUrl` (no open redirect).

### Portal-side changes (careyos repo, `archieves305/careyos`)

Deployed via `scripts/deploy-careyos.sh` (pull → npm ci → build → pm2
restart → health check). Healthy, HTTP 200, fleet unaffected.

- `6021c30` — `construction-crm` appRoles replaced: the placeholder four
  (ADMIN/MANAGER/**FIELD**/VIEWER) had no equivalent for SALES_REP,
  OFFICE_STAFF or MARKETING and would have flattened them. Now verbatim
  the CRM's seven `RoleName` values, `defaultAppRole: READ_ONLY`.
- `c79862b` — registry entry described an app that did not exist:
  `serverPath /var/www/construction-crm` (real `/opt/knuco`), `port 3116`
  (real 4000), pm2 (real: systemd `knuco`). Corrected; `url`/`subdomain` →
  `crm.careyos.com`. `status` left `"development"` — the app is in daily
  production use but its SSO integration was not yet proven.

### Data changes (no schema migrations)

- **careyos `AppAccess`**: Frank's grant `FIELD` → `CREW_LEAD` (scoped to
  the row PK). `FIELD` no longer exists in the deployed list;
  `decideAppAccess` would have degraded him to `READ_ONLY`.
- **CRM `users`**: `jgarcia@knuconstruction.com` →
  `jgarcia@calibertrust.com`, in place, preserving
  `id=cmovhcyfu000jkrbtdg9bf0rm`. SSO matches on email, so a mismatch would
  have minted a second user and orphaned **23 rows across 9 tables**
  (leads, stage history, assignments, activity, files, jobs). Verified all
  23 still resolve. A prior scan confirmed `users.email` was the only place
  that address was stored.
- Grants for erica / lvalladares already existed by the time they were
  applied (`INSERT 0 0`, `ON CONFLICT DO NOTHING`) — Richard added them.

### Bugs fixed

- **Unsubscribe links never worked** (pre-existing, silent).
  `/api/email/unsubscribe` was missing from the middleware allowlist, so
  every recipient — and Gmail's `List-Unsubscribe-Post` POST — was 307'd to
  `/login` before the route ran. The route verifies its own HMAC token,
  rate-limits itself and renders standalone HTML; it was always meant to be
  public. Fixed narrowly (`/api/email/unsubscribe`, not `/api/email`) and
  covered by `src/middleware.test.ts`, verified to fail without the fix.
- **cc-allocator expense postings** silently failing via POST-through-302
  (above).
- **Portal registry** pointing at a non-existent path/port/process manager.

### Verification

- 257/257 vitest across 29 files (was 233/27). Typecheck clean. Production
  build compiles. Lint 6 errors / 29 warnings — **unchanged baseline**, all
  in files not touched this session.
- Deploy 1 `fde7bb2` (140s) — unsubscribe fix live, `APP_BASE_URL` active,
  phone-routing route present.
- Deploy 2 `0759ee8` (154s) — SSO. Clean journal, 26/26 pm2 online.
- Production probes: anonymous → portal login with return path preserved;
  `/api/me` no cookie → denied; **forged cookie → 401 on `/api/me` and 307
  on `/jobs`** (proves the portal call happens and fails closed); removed
  credential routes 404.

⚠️ **The authenticated happy path was not verified at deploy time** —
obtaining a real `careyos_session` requires a CareyOS password, so a human
had to confirm it. **Since closed: verified 2026-08-03** (Frank/CREW_LEAD →
`/field`, sign-out → portal). The rollback path below is retained for the
record only; it is no longer the standing recommendation.

Rollback (historical): `git revert 0759ee8 && git push`, redeploy; or the
tarball `/var/backups/knuco/pre-deploy-20260723-094258.tar.gz`. No
migrations ran, so the DB was unaffected either way.
