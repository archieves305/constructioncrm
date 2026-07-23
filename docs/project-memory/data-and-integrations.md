# Data & Integrations — KNU Construction CRM

_Updated 2026-07-23._

## Outbound URL construction

Every absolute URL that leaves the app is built from **`APP_BASE_URL`**
(falls back to `NEXTAUTH_URL`; trailing slash stripped centrally, so
`${env.APP_BASE_URL}/path` is safe). Changing the public hostname is one env
var — it is deliberately decoupled from auth config.

Call sites: `/action/<token>` tracked links, unsubscribe URLs, the
`/co/<token>` change-order portal, both field-log cron digests, and the
Zapier Roofr callback URL.

## Inbound — machine callers

All under `/api/integrations/*`, bearer-authenticated, and on the middleware
public allowlist. Convention: **503 when the server-side key is unset**
(operator misconfiguration), **401 on a missing/wrong header** (caller
problem).

| Endpoint | Caller | Auth | Status |
|---|---|---|---|
| `/api/integrations/cc-allocator/jobs` | cc-allocator | `CC_ALLOCATOR_API_KEY` | live |
| `/api/integrations/cc-allocator/expense` | cc-allocator (**POST**) | same | live |
| `/api/integrations/zapier/roofr-callback` | Zapier | `ZAPIER_WEBHOOK_SECRET` | live |
| `/api/integrations/phone-routing/lead` | knu-phone-routing (**POST**) | `PHONE_ROUTING_API_KEY` | **deployed but inert — key unset, returns 503** |

**cc-allocator** holds `CRM_BASE_URL` in `/var/www/cc-allocator/.env`,
repointed to `https://crm.careyos.com` 2026-07-23. Its client is
`src/server/crm/client.ts`; line ~211 POSTs expenses. Restart with
`pm2 restart ccallocator ccallocator-worker --update-env`.

**knu-phone-routing** (`/var/www/knu-phone-routing`) has no CRM references
yet — the CRM side shipped first. Idempotent on the Telnyx call id; dedupes
by `primaryPhone` so a repeat caller augments the existing lead; logs a
Communication (CALL/INBOUND) + ActivityLog; fires `LEAD_CREATED` so
speed-to-lead follow-up runs.

## Cron

Four scripts in `/home/knuco/crm-cron/*.sh` — invoice-aging,
field-log-reminders, field-log-digest, payroll-weekly — POST to
**`http://127.0.0.1:4000`** with an `x-cron-secret` header. They bypass
nginx entirely, so hostname changes never affect them.

## Outbound providers

- **Twilio** — SMS, outbound only. The CRM exposes **no** inbound Twilio
  webhook, so nothing in the Twilio console points here.
- **MailerSend** — transactional email (`MAILERSEND_API_KEY`, `EMAIL_FROM`).
- **Outlook** — lead intake mailbox polling.
- **Zylow** — read-only property API for door-knock enrichment
  (`ZYLOW_API_KEY`, `ZYLOW_API_BASE`), mirrored to a local cache.

## CareyOS SSO

`app.careyos.com/api/sso/authorize?app=construction-crm`, Bearer =
the `careyos_session` cookie value. Response
`{ ok, user: {uid,email,role}, allowed, appRole }`. See architecture.md.

Identity is keyed on **email**, so portal and CRM addresses must match. The
CRM find-or-creates a `User` row on first login and mirrors `appRole` onto
`role_id`.

## Database

**No schema migrations in the 2026-07-23 session.** 57 migrations applied;
`prisma migrate status` reports up to date.

Data corrections made directly (both idempotent, scoped, verified):

- careyos `AppAccess` — Frank's `appRole` `FIELD` → `CREW_LEAD`.
- CRM `users` — `jgarcia@knuconstruction.com` → `jgarcia@calibertrust.com`,
  in place, `id` preserved (`cmovhcyfu000jkrbtdg9bf0rm`), 23 referencing
  rows across 9 tables intact.

Ongoing behavioural change: **SSO provisions CRM users on first login** and
keeps `role_id` in sync with the portal's `appRole`. A CRM row with
`isActive: false` still denies access regardless of the portal.

## API surface changes (2026-07-23)

**Added** — `/api/me` (client session), `/api/auth/sign-out` (portal logout
bounce), `/api/integrations/phone-routing/lead`.

**Removed** — `/api/auth/[...nextauth]`, `/api/auth/forgot-password`,
`/api/auth/reset-password`. `/login` is now a portal bounce.
