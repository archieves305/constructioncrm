# crm.knuconstruction.com → crm.careyos.com cutover

Status as of 2026-07-23. Phase 1 is done and committed on
`feat/app-base-url-and-phone-routing`.

## Corrected infrastructure picture

Both domains are on **the same droplet** — `knuco-droplet`, 161.35.0.183.
An earlier reading of this put CareyOS on `everglade-droplet`; that was
wrong (everglade's catch-all vhost answers any `Host` header, which looked
like a real 200). Byte-identical response bodies confirm knuco is the
CareyOS origin.

| Host | Serves |
|---|---|
| knuco-droplet (161.35.0.183) | `knuconstruction.com`, `crm.knuconstruction.com` (systemd `knuco`, port 4000, `/opt/knuco`), `careyos.com` + ~14 `*.careyos.com` apps (pm2) |
| everglade-droplet (134.199.197.141) | zylow (`closers.zylow.net`), fl-buyback — unrelated |

**No host move is required.** The original Phase 3 (containerize, Postgres
dump/restore, uploads transfer, replace `deploy.sh`, downtime window) is
cancelled.

`crm.careyos.com` currently returns 526 because its Cloudflare record points
at everglade, which presents a `closers.zylow.net` cert. Pointed at knuco it
already returns 307 → `/login`: knuco holds a Cloudflare Origin CA cert
covering `careyos.com` + `*.careyos.com`.

## The SSO

CareyOS is its own identity provider — `app.careyos.com`, port 3000,
`/var/www/careyos`. It holds all users, passwords and per-app access grants.
No third-party IdP.

Two integration modes:

- **Subdomain apps** (`*.careyos.com`): the portal sets an opaque
  `careyos_session` cookie scoped to `.careyos.com`. The app forwards it as
  a Bearer token to `GET /api/sso/authorize?app=<id>` per request and honors
  `ok` / `allowed`. Never holds `CAREYOS_SSO_SECRET`.
  Reference: `/var/www/cc-allocator/src/server/sso.ts` (~120 lines).
- **External domains**: redirect handoff via `/sso/launch` →
  `/sso/callback?sso=` → `POST /api/sso/exchange` → own first-party cookie.
  Documented in `/var/www/careyos/docs/sso-external-domain.md`.

**Moving to `crm.careyos.com` first means the handoff is never needed.** Do
the domain before the SSO, not the reverse.

## Phase 2 — SSO integration

### 2a. Identity reconciliation (BLOCKING — before any code)

7 active CRM users (5 ADMIN, 1 MANAGER, 1 CREW_LEAD) vs 16 portal users:

| CRM user | In portal |
|---|---|
| richard@rcareylaw.com | yes |
| ahurtado@calibertrust.com | yes |
| efelipe@calibertrust.com | yes |
| erica@calibertrust.com | yes |
| lvalladares@knuconstruction.com | yes |
| **frank@knuconstruction.com** | **no — create** |
| **jgarcia@knuconstruction.com** | **portal has `jgarcia@calibertrust.com`** |

The jgarcia mismatch is the dangerous one. SSO matches on email, so
find-or-create would mint a *second* CRM user and orphan the existing one's
leads, activity and assignments. Pick one canonical address and reconcile
**before** cutover — preferably by updating the CRM row's email in place, so
`User.id` and every FK survive.

Then create the 7 `AppAccess` grants with `appRole` matching each user's
current CRM role. There are currently **zero** `construction-crm` grants.

Confirm the CREW_LEAD has a portal password they can use on a phone — SSO-only
means no local fallback for field crew.

### 2b. Deploy the appRoles change

Branch `feat/crm-approles-seven` is pushed to `archieves305/careyos`. It
replaces the placeholder `["ADMIN","MANAGER","FIELD","VIEWER"]` with the CRM's
seven real `RoleName` values and sets `defaultAppRole: "READ_ONLY"`. Merge,
rebuild, `pm2 restart careyos`, then confirm the admin UI shows the 7-role
dropdown for Construction CRM.

Note `appRoles[0]` is what portal ADMINs implicitly receive — so a CareyOS
admin lands on CRM `ADMIN`. Intended.

### 2c. CRM-side SSO client

**`src/lib/auth/helpers.ts` is the seam.** `getSession()`, `requireSession()`
and `requireRole()` are used across the entire app. Reimplement those three on
top of SSO introspection and the vast majority of call sites need no change at
all. This is what keeps the diff sane.

- New `src/lib/sso.ts` modeled on cc-allocator's, but `await cookies()` —
  Next 16 made it async.
- Fail closed on missing cookie, non-2xx, or network error.
- New env (all optional at boot so the app still runs pre-cutover):
  `CAREYOS_SSO_URL`, `CAREYOS_APP_ID=construction-crm`,
  `CAREYOS_SSO_DEV_BYPASS=1` for local dev only.
- `appRole` → `RoleName` is now a validated 1:1 cast, since 2b made the
  strings identical. Reject unknown values rather than defaulting upward.
- Find-or-create the CRM `User` by email to keep FKs stable. Depends on 2a.
- Consider a short (30–60s) per-token introspection cache. The portal doc
  intends grant changes to apply "on next page load"; a fetch on every single
  request is a lot of chatter. Start without it, add if latency shows.

Keep enforcement in `src/middleware.ts` with its existing public allowlist
rather than restructuring to cc-allocator's layout-gate pattern — lower risk,
and the allowlist is already correct.

### 2d. Retire credentials auth

Remove `CredentialsProvider`, lockout and password-policy machinery; point
`/login` at the portal login instead of deleting the route. Leave the
`passwordHash` column and `password_reset_tokens` table in place for now and
drop them in a later, separate migration — additive-safe, and a fast rollback
path if SSO misbehaves in week one.

### 2e. Must stay public (unchanged)

`/co/*`, `/action/*`, `/api/co/*`, `/api/track/*`, `/api/email/unsubscribe`,
`/api/integrations/*` (bearer), `/api/cron/*` (`CRON_SECRET`).

## Phase 3 — Domain cutover (no host move)

1. ~~nginx server block for `crm.careyos.com` on knuco → `127.0.0.1:4000`.~~
   **DONE 2026-07-23.** `/etc/nginx/sites-available/crm.careyos.com`,
   symlinked into `sites-enabled`, using the existing
   `/etc/ssl/cloudflare/careyos-origin.{pem,key}`. `nginx -t` passed, nginx
   reloaded, no regressions across the fleet. Verified: a direct request to
   the origin with `Host: crm.careyos.com` returns 307 → `/login`.
2. ~~Cloudflare: repoint `crm.careyos.com` to knuco, proxied.~~
   **DONE 2026-07-23** (by Richard, dashboard). 526 cleared; verified serving
   the CRM with real client IPs reaching the origin.
3. ~~`/etc/knuco/env`: `NEXTAUTH_URL` / `APP_BASE_URL`.~~ **DONE 2026-07-23.**
   Both set to `https://crm.careyos.com`; backup at
   `/etc/knuco/env.bak-20260723-precutover`. `systemctl restart knuco`, clean
   journal. Note `APP_BASE_URL` is inert until Phase 1 deploys — the running
   build has no reference to it — but is set now so the switch is seamless.
   The `CAREYOS_*` SSO vars are still to come, in Phase 2.
4. ~~**Real client IP.**~~ **DONE 2026-07-23**, as part of step 1.
   `/etc/nginx/snippets/cloudflare-real-ip.conf` carries the Cloudflare v4/v6
   ranges plus `real_ip_header CF-Connecting-IP`, included by the new vhost.
   Without it every request would arrive as a Cloudflare edge IP, degrading
   the `ipAddress` recorded in `resolveTrackedLink` and collapsing IP-keyed
   rate limiting into shared buckets. Note the box had **no** CF real-IP
   config anywhere previously, so the other proxied apps still see edge IPs.
   Refresh the ranges from cloudflare.com/ips-v4 and /ips-v6 periodically.
5. ~~Update the CareyOS registry entry.~~ **DONE 2026-07-23**, commit
   `c79862b` on `feat/crm-approles-seven` (pushed, not yet deployed).
   `url`/`subdomain` → `crm.careyos.com`; `serverPath` → `/opt/knuco`;
   `port` → 4000; `pm2Name`/`deployScript` corrected to record that this is
   the one fleet app CareyOS neither deploys nor supervises. Nothing reads
   these fields — they were documentation, and they were wrong.
   `status` deliberately left `"development"`: the app is in daily production
   use, but its SSO integration has not landed.
6. ~~`deploy.sh` smoke test.~~ Supported since Phase 1 via
   `KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh`.
7. ~~Repoint external callers.~~ **DONE 2026-07-23.** Full sweep found:
   - **cc-allocator** — `CRM_BASE_URL` in `/var/www/cc-allocator/.env` was the
     only live reference. Repointed, `pm2 restart ccallocator
     ccallocator-worker`, verified 200 against the new host. This one
     mattered: `src/server/crm/client.ts:211` **POSTs** expenses, and Node's
     fetch downgrades POST to GET when following a 302, so postings were
     failing silently from the moment the redirect went in.
   - **knu-phone-routing** — no CRM references at all; not wired up yet
     (its CRM route is still on an unmerged branch).
   - **cron** — all four `/home/knuco/crm-cron/*.sh` call
     `http://127.0.0.1:4000` directly, bypassing nginx. Unaffected.
   - **Twilio** — outbound only; the CRM exposes no inbound webhook route.
   - **Zapier Roofr callback** — built per-request from env, so new orders
     use the new host automatically. See step 8 for orders already in flight.
8. ~~Old domain redirect.~~ **DONE 2026-07-23.** `crm.knuconstruction.com`
   serves a **302** to `https://crm.careyos.com$request_uri` (path and query
   preserved, verified against `/co/<token>`, `/action/<token>` and
   `?token=` URLs). ACME challenge path stays exempt so the LE cert keeps
   renewing. Backup at `sites-available/knuco.bak-20260723-precutover`.

   **`/api/integrations/` is proxied, not redirected.** Machine callers that
   still hold the old URL POST into it — notably Zapier's Roofr callback,
   whose URL is baked in per order, and 3 orders were sitting in `REQUESTED`
   at cutover. A 302 would have downgraded those POSTs to GET and dropped the
   body, exactly as it did to cc-allocator.

   Still to do: promote 302 → 301, **after SSO lands** and the new hostname
   has proven itself.

## Rollback

Until 2d lands, rollback is: revert the env vars, revert the nginx vhost. The
old domain stays live throughout, so a bad cutover is a DNS/env revert rather
than a restore.
