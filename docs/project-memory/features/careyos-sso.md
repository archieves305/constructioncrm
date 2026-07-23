# Feature — CareyOS SSO

_Shipped 2026-07-23 (`0759ee8`). Replaces local credentials entirely._

## Why this shape

The CRM moved to `crm.careyos.com` **before** SSO was implemented, and that
ordering was the whole point. On the parent domain the browser sends the
`careyos_session` cookie automatically, so the CRM became an ordinary fleet
app. Had SSO been built first, on `crm.knuconstruction.com`, it would have
needed the redirect-handoff flow — `/sso/launch` → short-lived token →
`/sso/callback` → `/api/sso/exchange` → own first-party cookie — documented
in the portal's `docs/sso-external-domain.md`, which was written
specifically for the CRM as "the first app off `.careyos.com`". All of that
was avoided.

## Files

| File | Role |
|---|---|
| `src/lib/sso.ts` | Portal client: `introspect()`, `loginUrl()`, `logoutUrl()`, `SESSION_COOKIE` |
| `src/lib/auth/helpers.ts` | The seam — `getSession`/`requireSession`/`requireRole`, user provisioning, role sync |
| `src/lib/auth/session-client.tsx` | Client `SessionProvider`/`useSession`/`signOut` |
| `src/app/api/me/route.ts` | Session for client components |
| `src/app/api/auth/sign-out/route.ts` | Bounce to portal logout |
| `src/middleware.ts` | Public allowlist + cookie presence |
| `src/app/(dashboard)/admin/layout.tsx` | New — ADMIN/MANAGER gate |
| `src/app/(dashboard)/layout.tsx`, `(field)/layout.tsx` | Session + role gates |
| `src/app/(auth)/login/page.tsx` | Portal bounce |

## Design decisions

1. **`helpers.ts` is the seam.** Keeping the signatures and return shape of
   `getSession`/`requireSession`/`requireRole` meant **~140 route handlers
   and pages needed no changes at all**. This is what kept a
   whole-application auth swap to 28 files.
2. **`React.cache` on `getSession`.** A single request touches it from a
   layout, a page and several helpers; without caching that is N portal
   round-trips. Per-request, so it never leaks between users.
3. **Middleware does not introspect.** The edge runtime has no database and
   no role, and a fetch per request is real latency. It answers only "is
   there a cookie?". Enforcement is server-side, where the session resolves
   live — *stronger* than the old JWT check, which trusted a token until it
   expired. A forged cookie passes middleware and is refused by
   `getSession()`.
4. **`appRole` is validated, not coerced.** The portal's `appRoles` list was
   changed to be verbatim the CRM's seven `RoleName` values, so this is a
   membership check. An unrecognised value is **refused**, not degraded to
   something plausible — silent downgrades hide drift. (The portal already
   degrades a stale grant to `defaultAppRole`, so reaching this branch means
   the two lists genuinely diverged.)
5. **Fail closed everywhere.** Missing cookie, non-2xx, unreachable portal,
   malformed JSON, missing user → denied. A portal outage must never become
   an open door. Nine tests assert exactly this.
6. **Local `isActive: false` still denies**, even when the portal allows.
   Two gates, and the CRM keeps an off switch.
7. **Boot refuses `CAREYOS_SSO_DEV_BYPASS=1` under `NODE_ENV=production`.**
   That flag makes every request an authenticated admin. A crashed service
   is loud; a silently open one is not.
8. **`/login` honours only relative `callbackUrl`.** Otherwise the bounce
   would be an open redirector.

## Roles

Portal `appRoles` for `construction-crm`, most → least privileged, matching
`ROLE_HIERARCHY` in `helpers.ts`:

`ADMIN` · `MANAGER` · `SALES_REP` · `OFFICE_STAFF` · `CREW_LEAD` ·
`MARKETING` · `READ_ONLY` — `defaultAppRole: READ_ONLY`.

A portal ADMIN with no explicit grant implicitly receives `appRoles[0]`
(ADMIN). Grants are managed per user in the CareyOS admin and apply on the
user's next page load — no re-login.

## Operational notes

- Signing out ends the session **fleet-wide**: the cookie is
  `.careyos.com`-scoped and owned by the portal, so a CRM-only sign-out is
  not something we can offer.
- New users are provisioned in the **CareyOS admin**, not the CRM. The CRM
  find-or-creates its `User` row on first login (names derived from the
  email local part when it has never seen the address).
- Because identity is keyed on email, portal and CRM addresses must match —
  a mismatch mints a second CRM user and orphans the original's records.
