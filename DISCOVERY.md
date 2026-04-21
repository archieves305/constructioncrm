# KNUCO Migration — Discovery

Generated: 2026-04-21 (America/New_York). Phase 1 section 3a (local, read-only).
Phase 1 section 3b (remote droplet discovery): **pending** — deferred until dedicated SSH key is generated and installed on the droplet.

---

## 1. Local repo summary

| Item | Value |
| --- | --- |
| Absolute path | `/Users/legalassistant/constructioncrm` |
| Working-tree size | 1.6 MB total; ~500 KB excluding `package-lock.json` |
| File count (excl. `node_modules`, `.git`, `.next`) | 457 |
| Git branch | `main`, clean, tracks `origin/main` |
| Git remote | `https://github.com/archieves305/constructioncrm.git` |
| Git history | 4 commits (fresh repo) |
| `core.autocrlf` | unset (no CRLF risk on macOS) |
| macOS timezone | America/New_York (EDT) |
| Repo previously run on this machine? | **No** — no `node_modules/`, no `.next/`, no `.env` file anywhere |

## 2. Stack

- **Framework:** Next.js 16.2.3 (App Router, TypeScript). `AGENTS.md` warns "This is NOT the Next.js you know — breaking changes from training data." Any code changes in later phases must consult `node_modules/next/dist/docs/` after `npm ci` runs.
- **React:** 19.2.4
- **Local Node runtime:** v25.9.0 (current release, **not LTS**)
- **CI Node:** 20 (`.github/workflows/ci.yml`) — inconsistency with local
- **Package manager:** npm (package-lock.json authoritative; pnpm installed but unused)
- **Dev server port:** `4000` (`next dev -p 4000`, `next start -p 4000`)
- **Build output:** `.next/` (default, gitignored)
- **Prisma client output:** `src/generated/prisma/` (custom path, gitignored — `prisma generate` must run before `next build` on every deploy)

## 3. Database

- **Engine:** PostgreSQL. Local version: **16.13** (Homebrew `postgresql@16` service, running, accepts connections on `/tmp:5432`).
- **ORM:** Prisma 7.7.0. Config: `prisma.config.ts` (TS-based, reads `process.env["DATABASE_URL"]`).
- **Schema:** `prisma/schema.prisma` — 35 KB, ~30 models, covers leads, jobs, stages, crews, permits, payments, inspections, referrals, reviews, communications, notifications, inbound email events, tracked action links, response metrics, AI sessions, manager alerts, intake settings.
- **Migrations on disk:** 3 folders under `prisma/migrations/`
  - `20260411232709_init` (17.8 KB)
  - `20260411234607_crm2_jobs_production` (11.8 KB)
  - `20260412030110_intake_notifications_tracking` (5.6 KB)
- **Migration provider lock:** `postgresql`
- **Seeds:** `prisma/seed.ts` (roles, lead stages, sources, service categories + **demo users with hardcoded passwords `admin123`/`rep123`/`mgr123`**), `prisma/seed-jobs.ts` (job stages + crews). Executed via `npx tsx`.

### 3.1 ⚠ Local DB vs. repo schema drift (blocking)

Local database `construction_crm` (owner DB role `crm_user`, UTF8 `en_US.UTF-8`) reports:

- 19 rows in `_prisma_migrations` (vs. 3 migration folders on disk → **migration history desynced**)
- Tables present that are **not in the current Prisma schema**: `incoming_receipts` (118 rows), `job_expenses` (67 rows), `follow_up_executions` (3), `password_reset_tokens` (2), `buildium_settings` (1), `payment_sources` (3)
- Tables in schema that are absent from local DB (e.g. `ai_sessions`, `tracked_action_links`) — not verified exhaustively; drift noted

Row counts for the rest: 86 activity_logs, 21 service_categories, 15 job_stages, 11 lead_stages, 11 lead_stage_history, 10 lead_services, 10 lead_sources, 6 crews, 6 roles, 5 tasks, 5 job_stage_history, 4 leads, 3 jobs, 3 users, 3 notification_events, 2 lead_assignments, 1 each of files/message_templates/payments/follow_up_rules, etc.

**Implication:** `prisma migrate deploy` against a dump of this local DB would either skip everything (if migration IDs differ) or fail. The current code on `main` cannot correctly read/write this DB as-is.

**Decision required (Q1, below).**

## 4. Auth

- **Library:** NextAuth v4.24.13
- **Provider:** Credentials (email + password, bcryptjs hashing)
- **Session strategy:** JWT, 8-hour maxAge
- **Adapter:** `@auth/prisma-adapter` is in `package.json` but **not wired into `authOptions`** — JWT-only, no DB session tables required
- **Middleware:** `src/middleware.ts` redirects unauthenticated to `/login`; public routes: `/login`, `/action/*`, `/api/auth/*`, `/api/track/*`, `/_next/*`, `/favicon.ico`; `/admin/*` requires `ADMIN` or `MANAGER` role
- **Role hierarchy:** ADMIN (100) > MANAGER (80) > SALES_REP (60) > OFFICE_STAFF (50) > MARKETING (40) > READ_ONLY (10)

## 5. External integrations

| Integration | File | Required env vars |
| --- | --- | --- |
| Twilio SMS (REST API) | `src/lib/services/notifications/twilio-provider.ts` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Microsoft Graph (Outlook email intake, client-credentials) | `src/lib/services/intake/outlook-provider.ts` | `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_MAILBOX_ADDRESS` |

No S3/Spaces SDK, no payment/Stripe, no external auth provider, no third-party logger.

## 6. Env-var manifest (from `src/lib/env.ts`, zod source of truth)

Required at boot — `env.ts` **throws** at module load if any are missing or invalid, so the app will fail to start rather than boot in a degraded state:

- `NODE_ENV` (enum: development | test | production; defaults to `development`)
- `DATABASE_URL` (must be a valid URL)
- `NEXTAUTH_URL` (must be a valid URL)
- `NEXTAUTH_SECRET` (min 32 chars)

Optional at boot, required at runtime when feature is used (`assertProviderEnv()` throws otherwise):

- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Outlook: `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_MAILBOX_ADDRESS`

## 7. Env-file situation

- **No `.env` / `.env.local` / `.env.development` / `.env.production` / `.envrc` anywhere in the repo.**
- `.gitignore` lists `.env*`, so env files are correctly excluded from version control (if they existed).
- Neither `~/.zshrc` nor `~/.zprofile` contains `DATABASE_URL` / `NEXTAUTH_SECRET` / `TWILIO*` / `OUTLOOK*`. `~/.zshenv` does not exist.
- Most likely: local dev has never been fully wired up on this laptop, OR the user launches `next dev` with env vars set inline. Local Postgres is Homebrew default (typically `trust` auth for local socket connections), which means `DATABASE_URL=postgresql://crm_user@localhost/construction_crm` would work without a password.
- **See Q10 — Where is DATABASE_URL coming from on this machine?**

## 8. API surface (route.ts files under `src/app/api/`)

- Public (no auth): `/api/auth/[...nextauth]`, `/api/track/[token]`
- Authenticated: `/api/leads[/...]`, `/api/jobs[/...]`, `/api/crews[/...]`, `/api/permits[/...]`, `/api/tasks[/...]`, `/api/referrals`, `/api/reviews`, `/api/reports[/response-times]`, `/api/messaging`, `/api/intake`, `/api/intake/process`
- Admin-only (ADMIN or MANAGER): `/api/admin/users[/[id]]`, `/api/admin/services`, `/api/admin/sources`, `/api/admin/stages`, `/api/admin/intake-settings`

## 9. Background / scheduled work

- **No cron, worker, scheduler, or queue code exists in the repo.**
- However, `IntakeSettings.pollingIntervalSec` defaults to 60 s, implying a cron is expected for Outlook email polling.
- **Gap:** `/api/intake/process` is NextAuth-protected (role ADMIN or MANAGER) with no API-token bypass, so a headless cron cannot call it. See Q3.

## 10. File storage

- Schema has a `files` table with an opaque `storage_key`, but no S3/Spaces/local-disk wiring is present in `src/lib/services/`.
- No `uploads/`, `storage/`, `media/`, `attachments/` directory in the repo.
- **File-upload feature appears unfinished or not yet wired to a storage backend.** See Q4.

## 11. Security headers (`next.config.ts`)

- HSTS: `max-age=63072000; includeSubDomains; preload` — **preload is near-irreversible once submitted to the browser preload list.** Recommend dropping `preload` until prod is stable for several months. See Q9.
- CSP: starter — allows `'unsafe-inline'` + `'unsafe-eval'` for scripts, `'unsafe-inline'` for styles. Marked "Tighten once we've inventoried inline scripts/fonts/images." Known gap; not blocking for migration.
- X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy denies camera/microphone/geolocation/browsing-topics.

## 12. Hardcoded hosts

- Grep of `src/` for `localhost` / `127.0.0.1` / `0.0.0.0` → **none**.
- Tracked-link BASE_URL uses `env.NEXTAUTH_URL`, so production SMS links follow the deployed URL — nothing to rewrite.

## 13. CI (`.github/workflows/ci.yml`)

- Triggers: pull_request, push to main
- Runner: ubuntu-latest, Node 20, npm cache
- Placeholder env for build-time zod check: `DATABASE_URL=postgresql://ci:ci@localhost:5432/ci`, `NEXTAUTH_URL=http://localhost:4000`, `NEXTAUTH_SECRET=ci_placeholder_secret_ci_placeholder_secret`
- Steps: checkout → setup-node@v4 → `npm ci` → `npx prisma generate` → `npm run lint` → `npm run typecheck` → `npm run build`
- No CD step — deploy workflow to be added in Phase 7.

## 14. Local SSH state

- `~/.ssh/` contents: `config` (1-line `Include /Users/legalassistant/.colima/ssh_config`), `known_hosts`, `known_hosts.old`, `agent/` subdir. **No `id_*` private keys.**
- No `~/.ssh/config` entry for the droplet.
- Tailscale CLI not installed; user confirmed droplet is not on tailnet.
- **Dedicated key not yet generated.** Proposed command in Q11.

## 15. Local environment summary

| | |
| --- | --- |
| OS | macOS (Darwin 25.4.0) |
| Shell | zsh |
| Node | v25.9.0 |
| npm | 11.12.1 |
| pnpm | 9.15.9 (installed, unused) |
| Python3 | 3.9.6 |
| Postgres | 16.13 Homebrew, service running |
| Timezone | America/New_York (EDT) |
| Tailscale | not installed |

---

## 16. Remote droplet — Phase 1 3b executed (2026-04-21)

Read-only inventory completed via `ssh knuco-droplet` on 2026-04-21 after `KEY AUTH VERIFIED`. No writes on the remote side. Findings in section 17.

---

## 17. Remote droplet findings

### 17.1 Identity / hypervisor

| Item | Value |
| --- | --- |
| Hostname (static) | `KNUCO` |
| OS | Ubuntu 24.04.3 LTS (Noble Numbat) |
| Kernel | Linux 6.8.0-71-generic x86_64 |
| Chassis / vendor | DigitalOcean Droplet, KVM virtualization |
| Cloud-init | `done` |
| Uptime at discovery | ~4h 42m, load avg 0.00 |

### 17.2 Hardware / resources

| Item | Value |
| --- | --- |
| vCPUs | 2 |
| RAM | 3.8 GiB total, 424 MiB used, 3.4 GiB available |
| **Swap** | **None configured** — must add ~2 GB swapfile in Phase 3 before first `npm ci` / `next build` |
| Root disk | `/dev/vda1` — 119 GB total, 2 GB used, 114 GB available |
| `/boot` | `/dev/vda16` 913 MB |
| `/boot/efi` | `/dev/vda15` 105 MB |
| **⚠ Block Storage volume** | `/dev/sda` — **10 GB DO volume**, mounted at `/mnt/volume_nyc1_1776773233539`, 24 KB used. **Not mentioned in the original Phase 1 environment briefing.** See Q13. |
| Config disk | `/dev/vdb` 488 KB (cloud-init data ISO) |

### 17.3 Network interfaces

| Interface | Addresses |
| --- | --- |
| `lo` | 127.0.0.1/8 |
| `eth0` | **161.35.0.183/20 (public)** + **10.10.0.5/16 (VPC — authoritative private)** + link-local IPv6 |
| `eth1` | 10.116.0.2/20 (DO legacy private networking) + link-local IPv6 |

- Default route: via `161.35.0.1` dev eth0.
- **Private-IP reconciliation:** original briefing reported `10.116.0.2`. Discovery shows both `10.10.0.5` (eth0/VPC) and `10.116.0.2` (eth1/legacy) exist. **User designated `10.10.0.5` authoritative.** Phase 3 UFW and service-binding decisions favour eth0/VPC.

### 17.4 Listening sockets

| Proto | Addr | Port | Process |
| --- | --- | --- | --- |
| TCP | 0.0.0.0 + `[::]` | 22 | sshd |
| TCP/UDP | 127.0.0.53, 127.0.0.54 | 53 | systemd-resolved (local DNS cache only) |

No other listeners. Nothing on 80/443/5432/3000/4000. Clean.

### 17.5 Firewall state — **fully open**

- **UFW:** installed (`/usr/sbin/ufw`), **inactive**. No rules.
- **iptables:** all chains default ACCEPT, zero rules.
- **fail2ban:** **not installed**.
- DO cloud firewall: not visible from the droplet — verify state in DO web UI before Phase 3.

### 17.6 SSH daemon state (current, pre-hardening)

| Directive | Effective value |
| --- | --- |
| `PermitRootLogin` | **yes** ⚠ |
| `PasswordAuthentication` | **yes** ⚠ |
| `PubkeyAuthentication` | yes |
| `KbdInteractiveAuthentication` | no |
| `PermitEmptyPasswords` | no |
| `UsePAM` | yes |
| `Port` | 22 |

Source files show one `sshd_config.d/*` entry sets `PasswordAuthentication no` and another sets `yes` — last-match wins. Both sources must be cleaned up in Phase 3.

**Phase 3 hardening order** (with a second SSH session kept open as escape hatch):
1. Create `knuco` user with sudo; install pubkey to `/home/knuco/.ssh/authorized_keys` (chmod 600).
2. Verify `ssh knuco@161.35.0.183` works from a fresh laptop terminal (key auth, no prompt).
3. Clean up conflicting `sshd_config.d` entries so `PermitRootLogin no` + `PasswordAuthentication no` win unambiguously.
4. `sshd -t` before reload.
5. `systemctl reload ssh` (not restart — keeps active sessions up).
6. From a new terminal, confirm key auth still works and password is refused.

### 17.7 Users + authorized_keys

- UID 0: `root` (`/root`, `/bin/bash`).
- UID ≥ 1000: **none** (only `nobody`). Clean base — no pre-existing human users.
- `/root/.ssh/authorized_keys`: 108 bytes, 1 line, comment `knuco-do-deploy 2026-04-21`. Exactly the single key we installed. No other entries.

### 17.8 Installed software

| Category | State |
| --- | --- |
| Node / npm / pnpm / yarn | **Not installed** |
| Nginx / Apache | **Not installed** |
| PostgreSQL / MySQL / MariaDB / Redis | **Not installed** |
| Docker / Podman | **Not installed** |
| Certbot | **Not installed** |
| fail2ban | **Not installed** |

Present: python3 3.12.3, git 2.43.0, ufw 0.36.2 (inactive), curl 8.5.0, wget 1.21.4, rsync 3.2.7, jq 1.7, logrotate 3.21.0, cron. Clean base image — every runtime/web-server/DB install is net new in Phase 3.

### 17.9 Timezone / locale

| Item | Value |
| --- | --- |
| Timezone | `Etc/UTC` (UTC +0000) |
| NTP | active, synchronized |
| Locale | `C.UTF-8` |

- **Recommendation:** keep droplet on UTC (server best practice; decouples from DST, eases log correlation). Local dev is America/New_York — mismatch is fine; Prisma/JavaScript handle display-zone conversion; DB stores in UTC regardless.
- **Recommendation:** bump locale to `en_US.UTF-8` during Phase 3 initdb so prod Postgres matches the local `construction_crm` collation.

### 17.10 System-level pending work (feeds Phase 3)

- **170 apt packages upgradable** per `apt list --upgradable`; cloud-init login banner reported 176 with 128 security. `unattended-upgrades.service` is active and enabled, but backlog hasn't drained. Phase 3 first step: `apt update && apt upgrade -y && (reboot if kernel updated)`.
- `droplet-agent.service` running; `/etc/cron.hourly/droplet-agent`. Leave in place — DO management agent (web console login, metadata sync).
- No swap (flagged above).
- No `root` crontab; standard Ubuntu system crons only.

### 17.11 DigitalOcean-specific artifacts

- `/opt/digitalocean/droplet-agent` present, service `droplet-agent.service` active.
- `/etc/motd.d/` with standard DO login banner content.
- No marketplace-image artifacts — this is a plain Ubuntu 24.04 image.

---

## 18. Open Questions

### Answered in thread (2026-04-21) — see MIGRATION_LOG.md for full text

- **Q1 DB strategy → A** with caveats. Start fresh on droplet with current 3 migrations. Local `construction_crm` left untouched. Gate: user confirming with original dev; posts `CONFIRMED: local DB is legacy, start fresh` before any action.
- **Q2 Seed → A**. Reference-only seed (no demo users). `scripts/create-admin.ts` prompts for email + password.
- **Q3 Intake cron → A, defer**. Manual-only at launch. `INTAKE_CRON_TOKEN` + systemd timer becomes first deploy-workflow dogfood later.
- **Q4 File uploads → pending dev confirmation**. Default if unwired: `/var/lib/knuco/uploads/` chmod 700, in nightly backup. **Do not create or wire in Phase 2.**
- **Q5 Node runtime → Node 22 LTS** via NodeSource, pinned to 22.x.
- **Q6 DB hosting → Postgres 16 on droplet**. Document `pg_dump | pg_restore` path to Managed DB in MIGRATION_PLAN.md.
- **Q7 Process manager → systemd**.
- **Q8 Deploy → rsync-based `deploy.sh`** with `--dry-run`, exclude list, confirmation prompt, abort if git dirty or not on `main`.
- **Q9 HSTS preload → drop `preload`**. Keep `max-age=63072000; includeSubDomains`. Phase 2 pre-flight one-line change.
- **Q10 Local env source → option 3** (app never run on this laptop). User will obtain reference env values from original dev; no dev values copied to prod; `.env.production` assembled fresh.
- **Q11 SSH key → generated** with passphrase + macOS Keychain (after `fdesetup status` returned Off). Key auth verified 2026-04-21.
- **Q12 Commit timing → commit both files after 3b**. Secret-pattern scan runs first.

### Open Questions raised by user (pending original-dev consultation)

- **OQ-A:** user confirming local `construction_crm` contains nothing worth preserving → awaits `CONFIRMED: local DB is legacy, start fresh`.
- **OQ-B:** whether `files` / `storage_key` upload feature is currently used anywhere, and if yes, where files live now.
- **OQ-C:** reference values for the env manifest (variable names / semantics, not values to copy verbatim) from original dev.

### New Open Questions from droplet state (Phase 2 blockers)

#### Q13 — 10 GB DO Block Storage volume (`/dev/sda` → `/mnt/volume_nyc1_1776773233539`)

Not in the original briefing. Options:
- **A.** Use as Postgres data dir (`/var/lib/postgresql/16/main`). I/O isolation, volume snapshots decoupled from droplet snapshots, grow-online in DO UI. **Recommended given Q6 = droplet-local Postgres.**
- **B.** Use as backup destination (`/var/backups/knuco/`). Backups survive droplet rebuild.
- **C.** Use for uploads dir (`/var/lib/knuco/uploads/`). Depends on Q4 outcome.
- **D.** Detach and stop paying (DO bills per GB-month regardless of use).
- **E.** Leave mounted, unused, revisit later.

My lean: **A**. Local DB is ~KB-sized; 10 GB gives years of headroom, and we can grow online.

#### Q14 — Locale bump

Bump droplet locale from `C.UTF-8` to `en_US.UTF-8` in Phase 3? Matches your local Postgres collation and standard dev env. My lean: **yes**. Small one-time change; avoids collation surprises later.

#### Q15 — SSH port

Keep on 22 or move to non-standard port in Phase 3? Key-only auth + fail2ban + UFW are already the real mitigation; port-moving is mostly log-noise reduction. Tailscale post-Phase-8 is the stronger answer. My lean: **keep 22**.

#### Q16 — `eth1` / `10.116.0.2` handling

The legacy private interface isn't being used for anything. Options:
- **A.** Leave alone (zero risk, ignore it).
- **B.** Disable via netplan to reduce attack surface (marginal gain).

My lean: **A**, unless you have other infra on DO's legacy private network.

---

## 19. Phase 1 status

- **3a local discovery:** complete.
- **3b remote discovery:** complete (sections 16–17).
- **SSH key provisioning + key-auth verification:** complete (2026-04-21).
- **`~/.ssh/config` updated** with `Host knuco-droplet` alias, backed up to `~/.ssh/config.bak-2026-04-21-phase1` before the edit.
- **Awaiting:** user review of section 17 findings and answers to Q13–Q16. OQ-A (local-DB legacy status) and OQ-B (uploads feature status) gate Phase 4 but do not block Phase 2 drafting.
- **Immediate next step:** secret-pattern scan on `DISCOVERY.md` + `MIGRATION_LOG.md` per Q12, then commit both with `chore(migration): phase 1 discovery — local + remote inventory`, then draft Phase 2 `MIGRATION_PLAN.md`. **Phase 3 execution will not begin until user posts `APPROVED — proceed to Phase 3`.**
