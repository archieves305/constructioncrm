# Architecture — KNU Construction CRM

_Updated 2026-07-23 (careyos.com cutover + SSO)._

## Runtime topology

Everything below runs on **knuco-droplet, 161.35.0.183** (DigitalOcean),
SSH alias `knuco-droplet`.

| Piece | Detail |
|---|---|
| App | Next.js 16.2.3 (App Router), `/opt/knuco`, port 4000 |
| Process | **systemd unit `knuco`** — not pm2, unlike the rest of the fleet |
| Deploy | `./deploy.sh` from Richard's Mac: rsync → `prisma migrate deploy` → build on server → restart, with pre-deploy DB dump + code tarball and automatic code rollback |
| DB | PostgreSQL, local, database `knuco` |
| Env | `/etc/knuco/env`, owned root, readable by user `knuco` |
| Public host | `https://crm.careyos.com`, Cloudflare-proxied |
| Old host | `crm.knuconstruction.com` — 302 to the new host (see below) |

The same droplet also runs **CareyOS** (`/var/www/careyos`, pm2, port 3000)
and ~14 sibling `*.careyos.com` apps, all pm2. The CRM is the only fleet app
CareyOS neither deploys nor supervises.

`everglade-droplet` (134.199.197.141) is unrelated — zylow and fl-buyback.
**SSH there runs a deploy script on login.**

## nginx

- `sites-available/crm.careyos.com` → `127.0.0.1:4000`, TLS via the
  Cloudflare Origin CA cert `/etc/ssl/cloudflare/careyos-origin.{pem,key}`
  (covers `careyos.com` + `*.careyos.com`).
- `snippets/cloudflare-real-ip.conf` — CF v4/v6 ranges +
  `real_ip_header CF-Connecting-IP`. **Required**: the host is proxied, so
  without it every client looks like a Cloudflare edge IP, breaking the
  `ipAddress` recorded for tracked links and any IP-keyed rate limiting.
  Refresh ranges from cloudflare.com/ips-v4 and /ips-v6 periodically.
- `sites-available/knuco` — the old hostname. Browser paths 302 to
  `https://crm.careyos.com$request_uri` (path + query preserved, so
  already-emailed `/co/<token>` and `/action/<token>` links survive).
  **`/api/integrations/` is proxied through instead of redirected**, because
  machine callers POST there and HTTP clients downgrade POST→GET when
  following a 302. The ACME challenge path is exempt so the LE cert keeps
  renewing. Still 302 rather than 301 — promote once SSO is proven.

## Auth flow

CareyOS at `app.careyos.com` is the **sole identity provider** for the
fleet. It owns users, passwords and per-app access grants. No third-party
IdP. The CRM never holds `CAREYOS_SSO_SECRET`.

Since the CRM sits on `crm.careyos.com` it is inside the `.careyos.com`
cookie scope and integrates the ordinary way — the redirect-handoff flow in
the portal's `docs/sso-external-domain.md` does **not** apply to it.

```
browser --careyos_session cookie--> CRM
CRM --Bearer <cookie>--> app.careyos.com/api/sso/authorize?app=construction-crm
                          -> { ok, user: {uid,email,role}, allowed, appRole }
```

- `ok` — token valid. `allowed` — active AND (portal ADMIN OR an AppAccess
  row). `appRole` — the CRM role, decided **live against the portal DB on
  every request**, so a grant or revoke applies on the next page load.
- The portal's `appRoles` for `construction-crm` are verbatim the CRM's
  seven `RoleName` values, so mapping is validation, not translation. An
  unrecognised value is refused, not guessed.
- A portal ADMIN with no explicit row implicitly gets `appRoles[0]` = ADMIN.

### Division of responsibility

- **CareyOS** authenticates and authorises.
- **The CRM** keeps its own `User` row as the anchor for foreign keys —
  leads, jobs, activity, files all reference `User.id` — and as a second
  gate: a row with `isActive: false` is denied regardless of the portal.
  Users are find-or-created by email on first SSO login; `role_id` is
  mirrored from `appRole` so role-filtered queries stay consistent.

### Enforcement points

| Layer | Does |
|---|---|
| `src/middleware.ts` | Public-path allowlist + "is there a session cookie?" only. No introspection (edge has no DB and no role, and it would add a network call per request). |
| `src/lib/auth/helpers.ts` | **The seam.** `getSession`/`requireSession`/`requireRole`, wrapped in `React.cache` so one request introspects once. ~140 route handlers call these. |
| `(dashboard)`, `(dashboard)/admin`, `(field)` layouts | Role gates, resolved live. Replaced the old middleware role checks. |
| `src/lib/auth/session-client.tsx` | Client `useSession`/`SessionProvider`, API-compatible with next-auth. Reads `/api/me`. |

A forged cookie passes middleware and is then refused by `getSession()`,
which fails closed on missing cookie, non-2xx, unreachable portal,
malformed body, or missing user.

## Legacy: NextAuth — REMOVED 2026-07-23

Credentials auth, `[...nextauth]`, `auth/options.ts` and the forgot/reset
password pages and routes are gone. `/login` is a bounce to the portal that
honours only relative `callbackUrl` values. `next-auth` remains in
`package.json` but is imported nowhere. `lockout.ts`, `password-policy.ts`,
`lockout-error.ts` and the password-setting path in `admin/users` are now
dead code, deliberately left in place to keep the auth change's blast radius
small — see known-issues.
