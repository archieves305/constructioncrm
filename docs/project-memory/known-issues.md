# Known Issues / Technical Debt — KNU Construction CRM

_Updated 2026-07-23._

## Open — needs a decision or action

- **SSO happy path is unverified.** As of the 2026-07-23 deploy, nobody has
  confirmed a real login works end to end. Everything reachable without a
  `careyos_session` cookie checks out, and a forged cookie is correctly
  refused, but obtaining a genuine cookie needs a CareyOS password. **First
  task next session: confirm login, especially Frank (CREW_LEAD → `/field`,
  the user with no fallback).** Rollback is `git revert 0759ee8` + redeploy,
  or the tarball `pre-deploy-20260723-094258.tar.gz`. No migrations ran.
- **jgarcia's portal grant is ADMIN; his CRM role was MANAGER.** The portal
  is now the live source of truth, so his next login syncs the CRM row **up
  to ADMIN** — full control including settings, other users' data and
  deletes. Silent privilege escalation unless intended. Change the grant in
  the CareyOS admin before he signs in if not.
- **`PHONE_ROUTING_API_KEY` is unset in `/etc/knuco/env`**, so
  `/api/integrations/phone-routing/lead` returns 503 (`503` = operator
  misconfiguration, `401` = bad caller — deliberate split). The route is
  deployed and correct; the integration is inert until the key is set.
  Optionally also `PHONE_ROUTING_SYSTEM_USER_ID` to pin attribution;
  otherwise it falls back to the first active ADMIN.
- **Old domain still serves a 302, not a 301.** Deliberate, for the cutover
  bake-in — browsers cache 301s hard and it is painful to walk back.
  Promote once SSO is proven.

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
