# KNUCO Migration — Audit Log

Chronological record of every decision, command executed, and finding during the KNUCO CRM migration from Richard's laptop (`/Users/legalassistant/constructioncrm`) to the DigitalOcean droplet at `161.35.0.183`.

- All timestamps in **America/New_York** (EDT/EST).
- Secret values are redacted as `<REDACTED>`.
- "User" below means Richard; "I" or "Claude" means the assistant.

---

## 2026-04-21

### Kickoff
- User provided Phase 0–11 migration prompt. Prime directive: plan-first, explicit APPROVED gate, verify every step, keep audit trail here.
- Confirmed known environment:
  - App: KNUCO CRM
  - Droplet: `161.35.0.183` (public), `10.116.0.2` (private)
  - Access: user has root password, terminal access
  - Domain: user owns `knuconstruction.com` at GoDaddy; will add `crm.knuconstruction.com` when told
  - Intent: full migration, ongoing dev-locally + deploy-to-prod workflow

### Clarifying questions answered (user)
- Project path confirmed: `/Users/legalassistant/constructioncrm`
- Branch to deploy from: `main`
- Env file handling: inventory filenames + variable names only in 3a, no production-template writing
- SSH approach: generate dedicated key on laptop (suggested name `~/.ssh/knuco_do_ed25519`), user will install public key interactively on the droplet, verify in second session, never handle root password
- Tailscale: clarified — user has Tailscale locally, but the droplet is **not** on the tailnet (clean base, added today). Proceed with public-IP SSH + UFW. Post-Phase-8: add droplet to tailnet as defense-in-depth, then close public port 22. Flag in `MIGRATION_PLAN.md`.
- Droplet image: plain Ubuntu 24.04 LTS, 4 GB / 2 vCPU / 120 GB, NYC1. Clean base.
- Parent domain: `knuconstruction.com` (GoDaddy). Subdomain TBD.
- `.gitignore`: surface anything found in 3a.
- Snapshot before Phase 3: acknowledged by user.
- `MIGRATION_LOG.md`: commit to repo, redact secrets.

### Phase 1 3a — Local discovery (read-only, no changes)
Started and completed local inventory. All commands were read-only (ls, cat via Read, psql -l, git status, node --version). No files created/modified except `DISCOVERY.md` and this log at the end.

Key findings (full detail in `DISCOVERY.md`):
- Tailscale CLI not installed on laptop (`command not found`). Consistent with user's "not on tailnet" statement.
- `~/.ssh/config` contains only `Include /Users/legalassistant/.colima/ssh_config`. No existing SSH keys in `~/.ssh/` (no `id_*`). Dedicated key still to be generated.
- Stack: Next.js 16.2.3 + React 19.2.4 + Prisma 7.7.0 + PostgreSQL + NextAuth 4 (Credentials, JWT session).
- Dev port: 4000.
- Node local 25.9.0, CI uses Node 20. Recommend Node 22 LTS for prod.
- Local Postgres 16.13 (Homebrew) running. Database `construction_crm` exists (owner role `crm_user`).
- **⚠ Local DB is drifted from repo schema:** 19 applied migrations per `_prisma_migrations` vs 3 on disk; local DB has tables not in current schema (`incoming_receipts` 118 rows, `job_expenses` 67 rows, `follow_up_executions`, `password_reset_tokens`, `buildium_settings`, `payment_sources`). Blocking question for Phase 2 (Q1 in DISCOVERY).
- **⚠ Seed file has hardcoded demo passwords** (`admin123`, `rep123`, `mgr123`). Must not run against prod as-is.
- **⚠ Email intake cron gap:** `/api/intake/process` is NextAuth-protected, no token bypass. Headless cron cannot call it without code change.
- No `.env` / `.env.local` / `.env.production` / `.envrc` in repo. No shell-rc export of `DATABASE_URL` / `NEXTAUTH_SECRET` / `TWILIO*` / `OUTLOOK*` in `~/.zshrc` or `~/.zprofile`. `~/.zshenv` does not exist.
- Repo appears to have never been run on this laptop (no `node_modules`, no `.next`).
- No Dockerfile, no docker-compose, no Procfile, no `ecosystem.config.js`, no `fly.toml`, no `vercel.json`. Clean single-target deploy.
- Macos timezone: America/New_York.

Env manifest (from `src/lib/env.ts` zod schema):
- Required at boot: `NODE_ENV`, `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.
- Optional (required if feature in use): Twilio (3 vars), Outlook (4 vars).
- `env.ts` throws at module load if invalid → app fails to start.

### Artifacts produced this session
- `/Users/legalassistant/constructioncrm/DISCOVERY.md` — Phase 1 3a deliverable + Open Questions Q1–Q12
- `/Users/legalassistant/constructioncrm/MIGRATION_LOG.md` — this file
- Memory files under `~/.claude/projects/.../memory/` (durable across Claude sessions, not committed to repo)

### Commands executed (this session, all read-only)
- `tailscale status` — not installed
- `ls -la ~/.ssh/`, `ls -la /Users/legalassistant/constructioncrm/`, `ls -la <project>/.env*` — filesystem inventory
- `git status`, `git remote -v`, `git branch -vv`, `git log --oneline -10`, `git config --get core.autocrlf`
- `node --version`, `npm --version`, `pnpm --version`, `yarn --version`, `bun --version`, `python3 --version`
- `du -sh`, `ls -la` on key subdirectories (src/, prisma/, .github/, public/, migrations/)
- `psql -U legalassistant -h 127.0.0.1 -l`, `psql -l`, `psql --version`, `postgres --version`
- `psql -d construction_crm -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ..."`
- Read: `package.json`, `.gitignore`, `README.md`, `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/seed-jobs.ts`, `prisma.config.ts`, `next.config.ts`, `src/middleware.ts`, `src/lib/env.ts`, `src/lib/db/prisma.ts`, `src/lib/auth/options.ts`, `src/lib/auth/helpers.ts`, `src/lib/services/notifications/twilio-provider.ts`, `src/lib/services/notifications/alert-service.ts`, `src/lib/services/intake/outlook-provider.ts`, `src/lib/services/intake/intake-service.ts`, `src/lib/services/tracking/tracked-links.ts`, `src/app/api/intake/process/route.ts`, `src/app/api/intake/route.ts`, `.github/workflows/ci.yml`, `~/.ssh/config`
- Grep: `process.env`, `DATABASE_URL|NEXTAUTH_SECRET|...` across repo and shell-rc files (files_with_matches mode — no values printed)
- Glob: `**/.env*`, `**/*.{example,template,sample}`, `src/app/api/**/route.ts`

### Current phase state
- Phase 1 3a: complete (DISCOVERY.md written).
- Phase 1 3b (remote discovery): **pending**, blocked on SSH key provisioning (Q11) and Open Question answers.
- Phase 2 onward: not started.

### Next action (awaiting user)
- User reviews DISCOVERY.md and answers Open Questions Q1–Q12.
- On APPROVAL of Q11: I run `ssh-keygen -t ed25519 -C "knuco-do-deploy 2026-04-21" -f ~/.ssh/knuco_do_ed25519 -N ""` on the laptop, then show the public key and pause.
- User installs public key on droplet, verifies key auth in a second session.
- I then execute Phase 1 3b (remote read-only discovery) and append to DISCOVERY.md.
- On Phase 1 sign-off: I commit DISCOVERY.md + MIGRATION_LOG.md (per user's directive).

---

### Q1–Q12 answers received (2026-04-21)

- **Q1 — DB strategy: A, with caveats.** Start fresh on droplet with the 3 current `prisma/migrations/` folders. Local `construction_crm` DB stays untouched as reference (do not drop, do not modify). Before acting: user is confirming with the original developer that the local DB contains nothing worth preserving. **Gate:** do nothing that assumes A until user posts `CONFIRMED: local DB is legacy, start fresh` in thread.
- **Q2 — Seed: A.** Reduced seed runs reference tables only (roles, lead stages, lead sources, service categories, job stages, crews). **No demo users.** Separate `scripts/create-admin.ts` (or similar) reads email + password from stdin (password non-echoed via `read -s` or Node prompt library), hashes with bcryptjs at the app's cost factor, inserts one ADMIN. Documented in RUNBOOK.md. Run once on droplet after first deploy.
- **Q3 — Intake cron: A, defer.** Ship without automated Outlook polling. Manual-trigger-only from admin UI at launch. `INTAKE_CRON_TOKEN` + systemd timer becomes the first real test of the deploy workflow *after* migration is stable (dogfood the deploy pipeline with a real feature, not a trivial footer change).
- **Q4 — File uploads: pending dev confirmation.** User is confirming with original dev whether `files`/`storage_key` is actually wired anywhere. Default plan if unwired: `/var/lib/knuco/uploads/` owned by app user, `chmod 700`, included in nightly backup tarball. Do **not** create the directory or add any storage wiring in Phase 2 — just note the decision. If dev says it is wired and files exist somewhere, handle transfer then.
- **Q5 — Node 22 LTS:** agreed. Install from NodeSource repo, pinned to 22.x.
- **Q6 — Postgres 16 on droplet:** agreed. Document in MIGRATION_PLAN.md the exact `pg_dump | pg_restore` path to migrate to DO Managed Database if/when we outgrow it.
- **Q7 — systemd:** agreed. Not PM2.
- **Q8 — rsync-based `deploy.sh`:** agreed. Must include: `--dry-run` mode, clear exclude list, explicit confirmation prompt before destructive remote steps, abort if `git status` is dirty, abort if not on `main`. No GitHub Actions for now.
- **Q9 — HSTS preload:** agreed, drop `preload`. Change `next.config.ts` from `max-age=63072000; includeSubDomains; preload` to `max-age=63072000; includeSubDomains`. Phase 2 pre-flight commit with clear message. Note in RUNBOOK.md that we can re-add preload and submit to hstspreload.org after 6 months of stable prod.
- **Q10 — Local env source:** option 3. App has never been run on this machine. User is migration lead, not original developer. Will obtain current `.env` reference values (variable names + semantics only — **no dev values will be copied to prod**) from original dev. `.env.production` will be constructed fresh: prod DB URL, `NEXTAUTH_URL=https://crm.knuconstruction.com`, `NEXTAUTH_SECRET` via `openssl rand -base64 48`, real Twilio/Outlook credentials obtained separately. User supplies final values to Claude for assembly into `/etc/knuco/env` before Phase 4 transfer.
- **Q11 — SSH key:** APPROVED conditionally. **Pre-flight: run `fdesetup status` first.** If on → proceed with no-passphrase ed25519. If off → STOP, switch to passphrase + ssh-agent. Also investigate `~/.ssh/agent/` dir and report (don't assume).
- **Q12 — Commit timing:** approved. Commit `DISCOVERY.md` + `MIGRATION_LOG.md` together after 3b completes. **Secret-pattern scan required before commit:** grep for `[A-Za-z0-9+/]{32,}=*`, `SECRET`, `TOKEN`, `KEY`, `PASSWORD`, `sk_`, `AKIA`, `xoxb-`; show hits to user for review. Commit message: `chore(migration): phase 1 discovery — local + remote inventory`.

### New Open Questions raised by user (pending original-dev consultation)
- **OQ-A (blocks Phase 4):** Local `construction_crm` confirmed legacy / contains nothing worth preserving. Awaiting `CONFIRMED: local DB is legacy, start fresh` in thread.
- **OQ-B (informs Phase 2 + 4):** Is the `files` / `storage_key` upload feature currently used anywhere? If yes, where do the files live now?
- **OQ-C (blocks Phase 4):** Reference values for env var manifest from original dev (for semantics / example format — not for copy-to-prod).

### Risk note — migration lead has never run this app locally
Migration lead (Richard) is not the original developer and has not previously run `npm run dev` against this codebase. Verification risk: I could deploy successfully per systemd/nginx/TLS signals but still ship a broken app, and the lead may not spot UI regressions during Phase 6 verification if they've never seen the working baseline.

**Mitigation (per user):** before production cutover, either (a) user runs `npm run dev` against a fresh local DB and confirms the app works on current `main` (we'd stand up a throwaway local `construction_crm_test` DB for this, leaving legacy DB untouched), or (b) original developer demos a working instance user can observe. Phase 6 verification must include an end-to-end UI test executed by the user with eyes on screen — not just HTTP 200 / journalctl green checks.

### Step 1 of user's order-of-operations — executed (2026-04-21)

Commands run (all read-only):
- `fdesetup status`
- `ls -la ~/.ssh/agent/`
- `lsof /Users/legalassistant/.ssh/agent/s.CMJtxXI8KH.agent.rm3odyx1Kh`
- Inspected `SSH_AUTH_SOCK` env var
- `ls -la ~/.colima/`
- `launchctl list | grep -i -E "ssh|agent|1password|colima"`
- `ps -ax | grep -i -E "ssh-agent|1password|colima|limactl"`
- `ls -d /Applications/1Password*.app`
- Read `~/.colima/ssh_config`

**Findings:**
- **FileVault: Off.** Per user gate, stop. Do not run `ssh-keygen -N ""`.
- **~/.ssh/agent/ explained:** stale Unix socket (`srw-------`, size 0, dated Apr 7). `lsof` reports no holder → orphaned. Not 1Password (app not installed). Not Colima (Colima uses `~/.colima/docker.sock` and `~/.colima/_lima/colima/ssh.sock`, both elsewhere; installed Apr 13, after orphan socket was created). Active SSH agent on this laptop is macOS's built-in launchd-managed ssh-agent at `/var/run/com.apple.launchd.*/Listeners`. Harmless leftover, not load-bearing. Leave it alone.

### Revised Q11 plan (awaiting user approval before executing)

Because FileVault is off, an unprotected private key on disk is readable by anyone with user-level access. Standard macOS mitigation: passphrase + Keychain-backed ssh-agent.

Two complications that mean **I cannot run the keygen myself**:
1. `ssh-keygen` prompts for passphrase interactively; passing `-N "<passphrase>"` leaks the passphrase to shell history / process list.
2. `ssh-add --apple-use-keychain` likewise prompts once.

**User-run command sequence (proposed, not yet run):**
```
ssh-keygen -t ed25519 -C "knuco-do-deploy 2026-04-21" -f ~/.ssh/knuco_do_ed25519
/usr/bin/ssh-add --apple-use-keychain ~/.ssh/knuco_do_ed25519
```
First prompts twice for passphrase (new + confirm). Second prompts once to load + cache in Keychain.

**Proposed `~/.ssh/config` addition (after key exists):**
```
Host knuco-droplet
    HostName 161.35.0.183
    User root
    IdentityFile ~/.ssh/knuco_do_ed25519
    IdentitiesOnly yes
    UseKeychain yes
    AddKeysToAgent yes
```
(`User root` is temporary — swap to app user after Phase 3 creates it.)

Waiting on user confirmation to proceed with this revised plan.

### Q11 corrections received (2026-04-21)

User APPROVED the `ssh-keygen` + `/usr/bin/ssh-add --apple-use-keychain` commands and the `Host knuco-droplet` config approach, with two corrections that must be applied before any `~/.ssh/config` edit:

1. **Literal config bytes shown for review before the Edit runs.** Comment lines in `~/.ssh/config` must be `#`-prefixed; unprefixed text is a parse error that breaks all SSH from this laptop — including the root-password fallback to the droplet. Claude has posted the literal multi-line content for verification in-thread.
2. **Timestamped backup before the Edit:** `cp ~/.ssh/config ~/.ssh/config.bak-2026-04-21-phase1`. One-command restore path (`mv ~/.ssh/config.bak-2026-04-21-phase1 ~/.ssh/config`) in case the edit is malformed.

Additionally, the first SSH connection from the laptop to `161.35.0.183` must use out-of-band host-key fingerprint verification (see next section) before accepting the host key into `~/.ssh/known_hosts`.

### Host key fingerprint verification procedure

Before user types `yes` at SSH's first-connection prompt to the droplet, the expected ed25519 (and rsa, ecdsa) host key fingerprints must be obtained out-of-band through the DigitalOcean web console.

- **Step A — Trusted sideband:** Log in to DigitalOcean web (HTTPS-to-DO-API, not SSH) → Droplets → select the droplet at `161.35.0.183` (confirm name/region NYC1/Ubuntu 24.04) → Access → Launch Droplet Console. Log in as `root` with root password.
- **Step A5 command to run in the DO web console:**
  ```
  for f in /etc/ssh/ssh_host_*_key.pub; do echo "--- $f ---"; ssh-keygen -lf "$f"; done
  ```
  Record the `SHA256:...` string for ED25519, RSA, and ECDSA keys.
- **Step B — First SSH from laptop:** `ssh root@161.35.0.183` (direct IP, not the alias — alias not yet written). Compare the fingerprint SSH displays against the matching key type from Step A. Only on a character-by-character match, type `yes`.
- **Step C — Key install:** Claude supplies the exact `authorized_keys` install one-liner after user pastes the `.pub` contents.
- **Step D — Future connections** (including via `knuco-droplet` alias once ~/.ssh/config is updated) validate automatically against the pinned entry in `~/.ssh/known_hosts`. A future mismatch would trigger `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` and refuse to connect until the stale entry is removed with `ssh-keygen -R 161.35.0.183`.

### Laptop security posture (2026-04-21)

- **FileVault: off** (per `fdesetup status`). **Non-blocking to-do before production cutover:** enable FileVault. Rationale: this laptop will hold (a) the SSH private key to the production droplet (`~/.ssh/knuco_do_ed25519`), (b) reference copies of `.env.production` during assembly, and (c) potentially DB dumps during backup verification. Enabling FileVault encrypts the disk at rest so that physical theft or offline disk access does not expose these artifacts. **Enabling FileVault does not affect any of the SSH configuration we're about to do and does not require re-running Phase 1** — it operates at the filesystem/device layer below SSH. Tracked as a post-migration hardening task alongside the post-Phase-8 Tailscale install.
- **Orphan SSH agent socket:** `~/.ssh/agent/s.CMJtxXI8KH.agent.rm3odyx1Kh` is a stale Unix socket (`srw-------`, size 0, dated Apr 7 2026, predates Colima install on Apr 13). `lsof` confirms no process holds it. **Not** a 1Password artifact (1Password not installed on `/Applications`). **Not** a Colima artifact (Colima uses `~/.colima/docker.sock` and `~/.colima/_lima/colima/ssh.sock`). Active SSH agent on this laptop is the stock macOS launchd-managed ssh-agent at `/var/run/com.apple.launchd.*/Listeners`. **Orphan socket left in place** — removing it is not required and provides no benefit.

### SSH key provisioning + key-auth verification (2026-04-21)

- User ran locally: `ssh-keygen -t ed25519 -C "knuco-do-deploy 2026-04-21" -f ~/.ssh/knuco_do_ed25519` (with passphrase, no `-N`). Passphrase never transited Claude's context.
- User ran locally: `/usr/bin/ssh-add --apple-use-keychain ~/.ssh/knuco_do_ed25519`. Passphrase cached in macOS Keychain.
- User retrieved expected ED25519 host-key fingerprint via DO web console (out-of-band, HTTPS to DO API): **`SHA256:D6wI0bTrgtt3fSnhgunSrCsdg55zJAICntbshwmRn6k`**. (ED25519 host-key fingerprint — public identifier, not a secret.)
- User installed pubkey to `/root/.ssh/authorized_keys` on the droplet via existing root-password SSH session.
- User ran `ssh -o IdentitiesOnly=yes -i ~/.ssh/knuco_do_ed25519 root@161.35.0.183` from a fresh laptop terminal, character-by-character verified the displayed `SHA256:D6wI0bTrgtt3fSnhgunSrCsdg55zJAICntbshwmRn6k` fingerprint against the out-of-band value, typed `yes`, pinned host key to `~/.ssh/known_hosts`. No password prompt — key + Keychain-cached passphrase path worked cleanly. Landed at `root@KNUCO:~#`. `Last login` line showed DO web console's exit IP `162.243.190.66`, consistent with user's prior session; nothing unexpected on the droplet between the two logins.
- User posted `KEY AUTH VERIFIED`.

### Phase 1 3b execution (2026-04-21)

Order of operations on Claude's side, after `KEY AUTH VERIFIED`:

1. **Backup:** `cp ~/.ssh/config ~/.ssh/config.bak-2026-04-21-phase1` → 48 bytes, size matches original.
2. **Edit `~/.ssh/config`:** added `Host knuco-droplet` block per literal-bytes content approved in-thread. Verified via subsequent Read: 10 lines, `#`-prefixed TODO comment on line 3, `Host` block with `HostName` / `User root` / `IdentityFile ~/.ssh/knuco_do_ed25519` / `IdentitiesOnly yes` / `UseKeychain yes` / `AddKeysToAgent yes`, 4-space indentation.
3. **Alias smoke test:** `ssh -o BatchMode=yes knuco-droplet 'echo ALIAS_OK && hostname && whoami'` → returned `ALIAS_OK / KNUCO / root`, no prompts. BatchMode disables interactive fallback, so any auth failure would have been fast-fail; success confirms key auth via alias.
4. **Remote read-only discovery:** single SSH session running a bash heredoc. Categories covered: OS, kernel, hardware, memory, disk (incl. block-storage volumes), swap, network interfaces and routes, listening sockets, UFW, iptables, fail2ban, sshd effective + file-level config, users, `/root/.ssh` state, installed runtimes and utilities, running + failed systemd units, DigitalOcean artifacts, cron state, apt upgradable count, unattended-upgrades state, timezone, locale, uptime, cloud-init. Zero writes on the droplet.
5. **Findings appended to `DISCOVERY.md` sections 16–17.** New open questions Q13–Q16 raised in DISCOVERY.md section 18.

Key outcomes (full detail in DISCOVERY.md):

- **Private-IP correction:** droplet has `10.10.0.5/16` on eth0 (VPC) plus `10.116.0.2/20` on eth1 (DO legacy private networking). User designated `10.10.0.5` authoritative going forward. Memory (`project_knuco.md`) updated with corrected value.
- **Surprise finding:** 10 GB DigitalOcean Block Storage volume attached at `/dev/sda` → `/mnt/volume_nyc1_1776773233539`. Not in original environment briefing. Tracked as Q13.
- **sshd state today:** `PermitRootLogin yes` + `PasswordAuthentication yes` in effective config (last-match wins over conflicting `sshd_config.d/*` files). **Must harden in Phase 3** — hardening order documented in DISCOVERY.md section 17.6.
- **170 apt packages upgradable** per `apt list --upgradable`; cloud-init banner reported 176 with 128 security updates. `unattended-upgrades` is active + enabled but backlog hasn't drained. Phase 3 first step: `apt update && apt upgrade -y && (reboot if kernel updated)`. Not done now.
- **Clean base image otherwise:** no Node / Nginx / Postgres / Docker / certbot / fail2ban / swap. UFW installed but inactive. Phase 3 installs everything.

### Open Questions added by 3b (Phase 2 blockers)

- **Q13:** What to do with the 10 GB Block Storage volume. My lean: A (Postgres data dir).
- **Q14:** Locale bump C.UTF-8 → en_US.UTF-8? My lean: yes.
- **Q15:** SSH port 22 vs non-standard? My lean: 22.
- **Q16:** eth1 / 10.116.0.2 — leave alone or disable? My lean: leave alone.

### Phase 1 commit (2026-04-21)

- Committed `DISCOVERY.md` + `MIGRATION_LOG.md` after secret-pattern scan returned no real secrets (only file paths, env-var names, the public ED25519 host-key fingerprint, and already-public values from `prisma/seed.ts` / `.github/workflows/ci.yml`).
- Per-repo git identity set: `user.email=richard@rcareylaw.com`, `user.name=archieves305` (matches the most recent prior commits in this repo). No global git config touched.
- Commit hash: `6d9fb9f` (full: `6d9fb9fbb5e9b21c808be8c9e7e9d0e6ed5e32ce`). Subject: `chore(migration): phase 1 discovery — local + remote inventory`. Author + Committer: `archieves305 <richard@rcareylaw.com>`.
- **Local commit only — not pushed.** Push deferred until user satisfied with Phase 2 plan and re-confirms no secret-shaped content lurks.

---

## 2026-04-21 (Phase 2 kickoff)

### All outstanding questions unblocked (user message)

- **Q1 (local DB):** `CONFIRMED — local construction_crm DB is legacy, start fresh.` User has previously seen the app running under a different macOS user with Tailscale; doesn't care about local data. Do not touch or read the local DB further.
- **Q2 (seed):** Option A confirmed. Reduced seed (reference rows only). Plus: write `scripts/create-admin.ts` accepting `--email --name --role` flags (and optional `--password`); generate cryptographically random password if not provided (`crypto.randomBytes`, 32+ chars); hash with bcryptjs at the app's existing cost factor (12); print generated password to stdout exactly once; **idempotent** — if email exists, print `USER EXISTS, skipping` and exit 0 (do not overwrite). Document invocation in RUNBOOK.md.
  - Production admin: email `richard@rcareylaw.com`, name `Richard Carey`, role `ADMIN`. Force-reset on first login if app supports it; otherwise rotate manually.
- **Q3 (intake cron):** Option A confirmed. Defer. Manual-trigger only.
- **Q4 (file uploads):** Assume not in production use. Create `/var/lib/knuco/uploads/` with correct ownership/perms, but no code wiring. Revisit when feature ships. No file transfer in Phase 4.
- **Q5–Q9:** All recommendations confirmed (Node 22 LTS, Postgres 16 on droplet, systemd, rsync `deploy.sh`, drop HSTS preload).
- **Q10 (env reference):** **Skip** original dev's `.env`. Use `src/lib/env.ts` zod schema as authoritative. Claude assembles `.env.production` template with placeholders; user fills production values. Specifics: `NODE_ENV=production`, `DATABASE_URL` constructed in Phase 4 from generated DB password, `NEXTAUTH_URL=https://crm.knuconstruction.com`, `NEXTAUTH_SECRET` via `openssl rand -base64 48`. Twilio + Outlook vars left unset at launch (optional in `env.ts`; features throw at runtime when invoked). User provides Twilio values when ready.
- **Q11 / Q12:** already resolved + committed.
- **Q13 (block volume):** APPROVED for Postgres data directory at `/mnt/volume_nyc1_1776773233539/postgres/main`. Requirements: verify volume empty before use; mount via `/etc/fstab` by UUID (not device path); standard rsync + data_directory swap procedure; ownership `postgres:postgres` mode 0700; document detach/reattach in RUNBOOK.
- **Q14 (locale):** bump to `en_US.UTF-8` (matches my recommendation; user confirmed).
- **Q15 (SSH port):** stay on 22 (matches my recommendation; user confirmed).
- **Q16 (eth1):** leave up, unused, no binds (matches my recommendation; user confirmed).
- **Local verification risk:** CLOSED. User has previously observed app running successfully on a different macOS user account. No further local verification required.

### Phase 2 drafting

- Started Phase 2 drafting per user authorization.
- Deliverable: `/Users/legalassistant/constructioncrm/MIGRATION_PLAN.md`. **Plan only** — no execution. Phase 3 awaits explicit `APPROVED — proceed to Phase 3` from user.
- Plan includes: target architecture, every numbered Phase 3-8 step with exact commands + verify + rollback, scripts/create-admin.ts and scripts/seed-prod.ts specs, .env.production assembly template, DNS instructions, full pitfall mitigation table mapped to user's original prompt, post-Phase-8 hardening (Tailscale, FileVault, HSTS preload re-add, intake cron), and a go/no-go checklist.

### Phase 2 plan review (2026-04-21)

User reviewed the initial draft and returned 10 corrections. All applied:

1. **3.7 sudo:** committed to Option A (NOPASSWD:ALL); RUNBOOK callout to revisit when team grows.
2. **3.6 knuco authorized_keys:** install pubkey by content (not by cloning `/root/.ssh/authorized_keys`); added byte-compare verification (`PUBKEY MATCH`/`MISMATCH`).
3. **3.8 sshd cleanup:** replaced blanket `sed -i ... /etc/ssh/sshd_config.d/*.conf` with `grep -lE` to identify only files containing conflicts, pause for user approval of the file list, then targeted edit per file.
4. **4.4 env transfer:** stream content via `ssh ... 'sudo -u knuco bash -c "umask 077; cat > /etc/knuco/env"' < /tmp/...`. No intermediate plaintext file on droplet's `/tmp`.
5. **4.4 NEXTAUTH_SECRET:** never echoed to terminal; goes silently into env file.
6. **3.14 DB password:** stdin-fed psql (no `-c` flag, so password never in argv on either side); history hygiene (`HISTCONTROL=ignorespace HISTFILE=/dev/null`); blocking "save to 1Password" prompt.
7. **3.13 data_directory edit:** stdin-fed Python heredoc replaces nested-quoted sed.
8. **5.6 backup script:** added comment about URL-regex coupling and migration path to `~postgres/.pgpass`; added empty-`DB_PASS` fail-loud check with redacted error message.
9. **§13 checklist:** DB password capture is now mandatory (no "or accepted not capturing" escape).
10. **§13 checklist:** new mandatory item for admin-login password capture in 4.9.

Plan corrections committed: hash `c162ba7` (full `c162ba770f8c0f114aa27b330c103dfdedfdefce`), subject `migration: apply review corrections to Phase 2 plan`. Local commit only — not pushed.

### Phase 3 pre-flight + go/no-go (2026-04-21)

User went through §13 go/no-go checklist:

- **Pre-Phase-3 DigitalOcean snapshot:** **intentionally skipped.** Rationale (user): droplet is fresh (created 2026-04-21, Phase 1 3b confirmed clean base, no production data at risk). Catastrophic-failure recovery path is destroy + recreate Ubuntu 24.04 droplet + reattach the 10 GB block-storage volume (~15 min, acceptable blast radius for Phase 3 only). **Pre-3.13 snapshot remains mandatory** (Postgres data-dir move is the actually-destructive operation).
- Second SSH session open as escape hatch (will remain open through end of Phase 3).
- DO web console bookmarked.
- No production traffic on droplet; reboots acceptable.
- DB password (3.14) and admin password (4.9) will be saved to password manager on generation.
- Sudo Option A confirmed.
- `openssl rand -base64 48` accepted for `NEXTAUTH_SECRET`; value goes straight to env, never displayed.
- Twilio + Outlook env vars empty at launch acceptable (manual-trigger intake at go-live).
- Local `construction_crm` DB will not be touched.

User posted: `GO/NO-GO: GO` and `APPROVED — proceed to Phase 3`. Authorized to execute step 3.1 only, pause for explicit `APPROVED — 3.2` before any further step.

## 2026-04-21 — Phase 3 execution

### 3.1 — apt full upgrade + reboot (Claude-executed, 2026-04-21 ~19:05 UTC)

- `apt-get update` clean.
- `DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade` — exit 0, **171 upgraded / 0 newly installed / 0 removed / 4 not upgraded** (4 phased updates held back, harmless), 77 s duration, no errors or warnings.
- `apt-get -y autoremove && autoclean` — clean.
- `apt list --upgradable | wc -l` after pass: **4** (the held phased updates).
- Kernel **not** updated (running `6.8.0-71-generic` before and after); `/var/run/reboot-required` set due to `libc6` upgrade.
- Reboot via `ssh knuco-droplet 'reboot'`. Boot-ID change confirmed: `9eee1d1c-a21b-4f98-a9f5-4e1de4cd2363` → `9eaa6322-8565-46d6-aab0-a29349de4049` (real reboot, not transient SSH success against pre-shutdown system).
- Reachable again after 2 poll attempts (~10 s).
- Post-reboot: `uptime -p` `up 0 minutes`, `uname -r` `6.8.0-71-generic`, `ssh.service active`, `systemctl is-system-running running`, 0 failed units.
- Note: user's escape-hatch SSH session was killed by the reboot (expected). Reopened by user before continuing.

### 3.2 — locale bump (USER-executed in escape-hatch session, 2026-04-21)

**Claude did not invoke this step.** User ran `locale-gen en_US.UTF-8` and `update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` (or equivalent) directly in their open root@KNUCO escape-hatch SSH session. User confirmed via `cat /etc/default/locale`:
```
LANG=en_US.UTF-8
LC_ALL=en_US.UTF-8
```
User explicitly directed Claude not to re-run; subsequent steps return to Claude-driven execution per updated feedback memory.

### 3.3 — swap file (Claude-executed, 2026-04-21 ~19:13 UTC)

- `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` — clean.
- Swap file UUID: `003e8003-a1b9-4b8c-80ae-dd204c418e1a`.
- `/etc/fstab` appended: `/swapfile none swap sw 0 0`.
- `sysctl vm.swappiness=10` + `/etc/sysctl.d/99-knuco-swap.conf` written.
- Verify: `swapon --show` shows 2G `/swapfile` prio -2; `free -h` shows Swap 2.0Gi total / 0B used; `cat /proc/sys/vm/swappiness` = 10; permissions on `/swapfile` are `-rw------- root root` (600).

### 3.4 — UFW enable (Claude-executed, 2026-04-21 ~19:14 UTC)

- Pre-state: `Status: inactive`.
- `ufw default deny incoming` + `ufw default allow outgoing`.
- Allow rules added BEFORE enable: 22/tcp `ssh`, 80/tcp `http (acme + nginx redirect)`, 443/tcp `https`. Both v4 and v6.
- `ufw --force enable` → "Firewall is active and enabled on system startup".
- Final `ufw status verbose`:
  ```
  Status: active
  Logging: on (low)
  Default: deny (incoming), allow (outgoing), disabled (routed)
  ```
  with the 3 allow rules (× 2 for IPv4 + IPv6 = 6 rule lines).
- **Fresh-SSH test:** new `ssh -o BatchMode=yes -o ConnectTimeout=10 knuco-droplet 'echo FRESH_SSH_OK'` → **`FRESH_SSH_OK`**. UFW did not lock us out.

### 3.5 — fail2ban (Claude-executed, 2026-04-21 ~19:15 UTC)

- `apt-get install -y fail2ban` clean.
- `systemctl enable --now fail2ban` → `is-active=active`, `is-enabled=enabled`.
- `fail2ban-client status` → 1 jail: `sshd` (enabled by default on Ubuntu 24.04; no `jail.local` needed).
- Journal source: `_SYSTEMD_UNIT=sshd.service + _COMM=sshd` (sshd jail uses systemd-journal backend).
- **Within 4 seconds of starting:** 16 total failed sshd attempts already filtered; **2 IPs banned**: `45.148.10.183`, `20.203.42.204` (opportunistic public-internet brute-force scanners). Confirms fail2ban is functioning.

### Phase 3 status as of end of 3.5

- Steps 3.1–3.5 complete. State on droplet: 171 packages upgraded (post-reboot), locale en_US.UTF-8, 2 GB swap, UFW active with 22/80/443 allow + default-deny, fail2ban running with active sshd jail.
- Working tree: MIGRATION_LOG.md modified (this section), uncommitted. Will batch with subsequent step entries.
- Next: pause for `APPROVED — 3.6 knuco user` per user's batch-approval instruction.

### 3.6 — knuco user + explicit pubkey install (Claude-executed, 2026-04-21 ~19:19 UTC)

- `adduser --disabled-password --gecos "KNUCO app user" knuco` clean — uid 1000 / gid 1000 assigned, /home/knuco created from /etc/skel.
- `usermod -aG sudo knuco` — added to `sudo` group.
- `install -d -m 700 -o knuco -g knuco /home/knuco/.ssh` — dir created with correct mode and ownership.
- Pubkey installed by content (NOT cloned from `/root/.ssh/authorized_keys`):
  ```
  echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILI3DkVYGEkX4qXHx+/RgaNH+7lxztmas17yxyPA2swM knuco-do-deploy 2026-04-21' \
    | ssh knuco-droplet 'install -m 600 -o knuco -g knuco /dev/stdin /home/knuco/.ssh/authorized_keys'
  ```
  Resulting file: 108 bytes, mode `-rw-------`, owner `knuco:knuco`.
- **Byte-compare:** `cat ~/.ssh/knuco_do_ed25519.pub` (laptop) vs `cat /home/knuco/.ssh/authorized_keys` (droplet, via ssh) → **MATCH**. Both strings: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILI3DkVYGEkX4qXHx+/RgaNH+7lxztmas17yxyPA2swM knuco-do-deploy 2026-04-21`.
- **Fresh-SSH-as-knuco verification:** `ssh -o BatchMode=yes knuco@161.35.0.183 'echo USER_OK && whoami && id && ls -la ~/.ssh/'` returned `USER_OK / knuco / uid=1000(knuco) gid=1000(knuco) groups=1000(knuco),27(sudo),100(users)` and ~/.ssh/ listing showed authorized_keys mode 600 owned knuco.
- Note: actual groups include `100(users)` in addition to plan-expected `27(sudo)`. This is `adduser`'s default supplementary-group behaviour on Ubuntu 24.04 (per `/etc/adduser.conf` defaults — `USERS_GID=100` + the `EXTRA_GROUPS=users` directive). Harmless; `users` group has no special privileges on this droplet. Could be removed with `gpasswd -d knuco users` for strict adherence to plan, but no functional reason to do so.
- root SSH still works (3.8 hardening will close that). knuco user is now an alternative SSH path for safety during 3.8.
- **User's independent fresh-terminal verification (pasted 2026-04-21 after 3.7):**
  ```
  legalassistant@Mac ~ % ssh -o BatchMode=yes knuco@161.35.0.183 'echo USER_OK && whoami && id'
  USER_OK
  knuco
  uid=1000(knuco) gid=1000(knuco) groups=1000(knuco),27(sudo),100(users)
  legalassistant@Mac ~ %
  ```
  No password prompt. Two working SSH paths confirmed (root@ and knuco@). User explicitly confirmed: leave the `100(users)` supplementary group membership as-is.

Working tree: MIGRATION_LOG.md modified (3.1–3.6 entries), uncommitted. Continuing batch.

Next: pause for `APPROVED — 3.7 sudo NOPASSWD:ALL`.

### 3.7 — sudo NOPASSWD:ALL (Claude-executed, 2026-04-21 ~19:22 UTC)

- User pre-approval message included a `<paste the three lines you actually saw here>` placeholder that was not filled in. Claude flagged this; user's `APPROVED — 3.7 sudo NOPASSWD:ALL` was explicit, so Claude proceeded. The same fresh-SSH-as-knuco verification was already executed Claude-side in 3.6 step 6 and returned `USER_OK / knuco / uid=1000(knuco) gid=1000(knuco) groups=1000(knuco),27(sudo),100(users)`. User subsequently pasted their actual terminal output (now spliced into the 3.6 entry above) confirming independent fresh-terminal verification with no password prompt.
- **Race note:** user sent a follow-up message with the actual paste + an explicit re-instruction to execute 3.7 step-by-step, which arrived AFTER Claude had already completed 3.7 (file written, visudo validated, fresh-SSH sudo -n confirmed). The actions taken matched the re-instruction exactly: file content `knuco ALL=(ALL) NOPASSWD:ALL`, mode 440 root:root, `visudo -c` parsed OK across all sudoers files, fresh-SSH `sudo -n true` returned `SUDO_OK` and `sudo -n whoami` returned `root`. No parse errors, nothing rolled back, no password prompts encountered.
- Wrote `/etc/sudoers.d/knuco` (root:root mode 440) with single line: `knuco ALL=(ALL) NOPASSWD:ALL` (29 bytes).
- `visudo -c` validated all sudoers files — parsed OK (sudoers + 90-cloud-init-users + README + knuco).
- `ssh -o BatchMode=yes knuco@161.35.0.183 'sudo -n true && echo SUDO_OK'` → `SUDO_OK` (no password prompt; NOPASSWD honored).
- `ssh -o BatchMode=yes knuco@161.35.0.183 'sudo -n whoami'` → `root` (knuco elevates cleanly).
- knuco user is now functionally equivalent to root for any sudo'd command, with the SSH key as the security boundary. Per user decision (Q3.7 Option A) and §13 go/no-go checklist; revisit when team grows beyond single operator.

Next: pause for `APPROVED — 3.8 sshd hardening`. **Note:** 3.8 is the highest-risk Phase 3 step. Reminder for user to ensure escape-hatch SSH session is open in a separate terminal before approving (and to leave it open through 3.8 completion).

### 3.8 — sshd hardening (Claude-executed with user-dictated pause points, 2026-04-21 ~19:30–19:45 UTC)

Executed with user-specified per-file edits (comment-block replacements rather than silent line deletion) and explicit pause points for inspection, post-edit review, post-write effective-config review, and post-reload verification.

**Inspection (read-only; identifies files with conflicting directives):**
- `/etc/ssh/sshd_config.d/50-cloud-init.conf` — `PasswordAuthentication yes` (27-byte file, mode 600, dated Apr 21 — created by cloud-init at droplet first boot).
- `/etc/ssh/sshd_config.d/60-cloudimg-settings.conf` — `PasswordAuthentication no` (26-byte file, mode 644, dated Aug 5 2025 — ships in the base cloud image).
- `/etc/ssh/sshd_config` line 42 — `PermitRootLogin yes`. Line 71 — `KbdInteractiveAuthentication no` (already at target value; left untouched).
- OpenSSH `Include /etc/ssh/sshd_config.d/*.conf` resolves drop-ins first-match-wins; the `50-` file's `yes` silently overrode the `60-` file's `no` in the current running config.

**Backups (pre-edit):**
- `/root/sshd-config-backup-pre-phase3/sshd_config` — original 3486-byte file preserved.
- `/root/sshd-config-backup-pre-phase3/sshd_config.d/` — both original drop-ins preserved with original modes.

**Per-file edits (stdin-fed Python, same pattern as 3.13 data_directory swap):** each conflicting directive replaced with a `#`-prefixed comment block stating removal date, reason, and pointer to `00-knuco-hardening.conf`. Before/after was shown in chat for each file. Final content: all three files contain comment-only text where the directive previously lived; `KbdInteractiveAuthentication no` in main sshd_config shifted from line 71 to 72 (because 1 directive line was replaced with 2 comment lines — net +1 line).

**`00-knuco-hardening.conf` written:** `/etc/ssh/sshd_config.d/00-knuco-hardening.conf` (501 bytes, mode 644, root:root). 5-line header comment + 8 directives per user's spec: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `ChallengeResponseAuthentication no`, `PubkeyAuthentication yes`, `PermitEmptyPasswords no`, `MaxAuthTries 3`, `LoginGraceTime 30`.

**Pre-reload validation:**
- `sshd -t` → exit 0, no output (syntax valid on the combined on-disk config).
- `sshd -T` filtered: all 8 directives at expected values; `permitrootlogin no`, `passwordauthentication no`, `maxauthtries 3`, `logingracetime 30`.
- `ChallengeResponseAuthentication` not listed in `sshd -T` output — modern OpenSSH aliases it to `KbdInteractiveAuthentication`; accepted at parse time, functionally equivalent. Included in our file for explicit belt-and-suspenders.

**Reload (on user's `RELOAD SSH` approval):**
- `ssh knuco-droplet 'systemctl reload ssh'` → exit 0, "RELOAD_OK". `ssh.service` remained active since 19:07:26 UTC (SIGHUP reload preserves the existing daemon PID and existing connections).

**Claude-side verification (3 fresh SSH attempts from laptop, immediately post-reload):**
- 2a — knuco key auth: exit 0, `KEY_AUTH_STILL_WORKS` returned ✓
- 2b — root key auth: exit 255, `root@161.35.0.183: Permission denied (publickey).` ✓ — `PermitRootLogin no` enforced.
- 2c — knuco with `PubkeyAuthentication=no` + `KbdInteractiveAuthentication=no` + `PreferredAuthentications=password`: exit 255, `knuco@161.35.0.183: Permission denied (publickey).` ✓ — `PasswordAuthentication no` enforced. (The "(publickey)" in the error message is the ssh-client's normal shorthand for "the server's remaining auth-method menu"; since the server now accepts only publickey and our client forbade publickey, no method overlap → auth fails. Expected result.)
- `sudo sshd -T` from knuco confirmed effective config post-reload matches pre-reload computed values.

### 3.8 incident — fail2ban banned the operator's laptop IP (2026-04-21)

**Summary.** The step 3.8 verification tests that are *designed to fail* (2b root-login-refused, 2c password-auth-refused) were logged by fail2ban as genuine sshd auth failures. Combined with Claude's Claude-side runs of the same commands from the same laptop public IP (`98.211.166.106`), the failure count crossed fail2ban's default threshold (5 failures / 10 min) and the IP was banned. The operator's Mac could no longer SSH to the droplet — neither as `knuco` (banned outright) nor as `root` (already hardened off).

**Claude's contribution.** Claude ran 2a/2b/2c Claude-side immediately after reload. 2b and 2c produced `Permission denied` responses that fail2ban counted. The operator then ran the same three commands from their own Mac terminal to do their independent verification, adding more failures from the same public IP. Neither run individually crossed the threshold, but the combined count did. **Claude did not flag the fail2ban interaction before executing 2b/2c** — the original plan's 3.8 verification block assumed the intentional failures wouldn't register against the jail. That is the gap the plan amendment below closes.

**Recovery via the correct out-of-band console.** DigitalOcean exposes two different web "consoles" that behave very differently after `PasswordAuthentication=no`:

| Path | What it is | Works after 3.8? |
| --- | --- | --- |
| DO UI → Droplet → Access → **"Launch Droplet Console"** button | Authenticates via the droplet's sshd + a DO one-time-password flow | **NO** — sshd refuses password auth |
| Direct URL `https://cloud.digitalocean.com/droplets/<droplet_id>/console?no_layout=true` | **QEMU virtual serial console** — talks to the hypervisor, not to sshd | **YES** — hypervisor-level; bypasses sshd/UFW/fail2ban entirely |

The operator reached the QEMU console via the direct URL (there's no button for it in the normal UI), logged in at the serial-console prompt with the droplet's `root` password, and ran:
- `fail2ban-client status sshd` — confirmed operator IP was banned.
- `fail2ban-client set sshd unbanip 98.211.166.106` — removed the ban.
- `systemctl restart fail2ban` — reset jail state.

**Permanent fix — whitelist file created** at `/etc/fail2ban/jail.d/knuco-whitelist.local`:
```
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 98.211.166.106
```
`sudo fail2ban-client get sshd ignoreip` returns all three entries post-restart; `Currently banned: 0` for the operator IP. Re-tested from Mac: `ssh -o BatchMode=yes knuco@161.35.0.183 'echo WORKS'` → `WORKS`. Hardening remains functionally correct.

**journalctl evidence (captured from the QEMU console during recovery):**
- `Accepted publickey for knuco from 98.211.166.106` — knuco key auth working as designed.
- `ROOT LOGIN REFUSED FROM 98.211.166.106` — root login blocked as designed.

**Functional verdict.** Hardening is correct. The incident was a **plan-level blind spot**, not a config error. Plan amendments applied in this same commit fix the gap for future runs:
- Step 3.5 now includes operator-IP whitelist creation immediately after fail2ban install, BEFORE any later step produces intentional auth failures.
- Step 3.8 has an explicit pre-verification warning requiring confirmation that the whitelist is in effect before running 2b/2c.
- Section 3 header has a prominent warning block distinguishing the "Launch Droplet Console" button (sshd-routed, becomes useless) from the QEMU serial console at `/console?no_layout=true` (hypervisor-routed, always works).
- Section 8 RUNBOOK documents the console distinction and adds a procedure for updating the whitelist when the operator's public IP changes (including the "SSH already down" case where recovery requires QEMU console).

**3.8 status:** functionally complete. Awaiting `APPROVED — 3.9` from user after plan amendments + incident log are committed and reviewed.

### 3.8 + plan amendments — committed (2026-04-21)

Two-commit split (per user direction, option 2):

- `87481d2` (full: `87481d20c4a1970ffa0ecefa43484ee9ce653510`) — subject `chore(migration): log phase 3 steps 3.1–3.7 (batched per-step entries)`. Captures the routine batched per-step audit-trail entries from 3.1 through 3.7 only. 1 file, +101 lines.
- `332530a` (full: `332530a63a262fbb5767a3462d5e5c2c8599f403`) — subject `migration: document 3.8 fail2ban incident, amend plan with operator-IP whitelist + console distinction`. Captures the 3.8 entry, the fail2ban incident report (this file), and all MIGRATION_PLAN.md amendments (section 3 console-distinction warning, 3.5 operator-IP whitelist sub-step, 3.8 pre-verification warning, section 8 RUNBOOK additions). 2 files, +125 / −7 lines.

Both local commits only — not pushed; push gate comes after operator review of full Phase 3 outcome.

### 3.9 — SSH alias swap, root → knuco (Claude-executed, 2026-04-21)

Laptop-side change only — droplet state not touched.

- **Backup:** `cp ~/.ssh/config ~/.ssh/config.bak-2026-04-21-phase3` → 310 bytes (matches pre-edit file size). The earlier `~/.ssh/config.bak-2026-04-21-phase1` (48 bytes — pre-Phase-1 state with only the `Include` line) is still in place as a deeper rollback point.
- **Edit applied to `~/.ssh/config`** (literal bytes pre-approved by user before write):
  - Removed the `# TODO (Phase 3): switch User from root to knuco after deploy user is created on the droplet.` comment line — TODO is now closed.
  - Changed `User root` to `User knuco` in the `Host knuco-droplet` block.
  - Untouched: `Include /Users/legalassistant/.colima/ssh_config` (line 1), the blank line between Include and Host block (line 2), `HostName 161.35.0.183`, `IdentityFile ~/.ssh/knuco_do_ed25519`, `IdentitiesOnly yes`, `UseKeychain yes`, `AddKeysToAgent yes`.
  - Resulting file: 217 bytes / 9 lines (was 310 bytes / 10 lines).
- **Verification (fresh ssh from laptop, BatchMode=yes so no prompts could mask a failure):**
  - `ssh -o BatchMode=yes knuco-droplet 'echo ALIAS_OK && whoami && hostname'` → `ALIAS_OK / knuco / KNUCO` ✓ (alias resolves to knuco user; remote hostname matches).
  - `ssh -o BatchMode=yes knuco-droplet 'sudo -n whoami'` → `root` ✓ (NOPASSWD sudo from 3.7 works through the alias; no password prompt).

**3.9 status:** complete. Phase 3 hardening is now operationally complete on both ends — droplet only accepts knuco's SSH key, and the laptop's `knuco-droplet` alias maps to the matching user with NOPASSWD root escalation available via `sudo`. The temporary "root via the alias" arrangement that lasted through 3.1–3.8 is closed.

Phase 3 progress: **3.1–3.9 done**. Remaining: 3.10 (volume mount via UUID + reboot test), 3.11 (Node 22 from NodeSource + apt-mark hold), 3.12 (PostgreSQL 16 from PGDG), 3.13 (Postgres data-dir move to the 10 GB block-storage volume — pre-3.13 DO snapshot mandatory per user), 3.14 (knuco DB + knuco_app DB user with strong password to 1Password), 3.15 (Nginx install), 3.16 (Certbot install), 3.17 (application directory structure under /opt/knuco, /etc/knuco/, /var/log/knuco/, /var/backups/knuco/, /var/lib/knuco/uploads/).

### 3.10 plan amendment — committed (2026-04-22)

Plan amendment to MIGRATION_PLAN.md § 3.10 + section 8 RUNBOOK volume-detach/reattach line committed as `dda5149` (full: `dda51493345cc3634da2b759f419c419484915ce`), subject `migration: amend 3.10 plan — prefer vendor-managed systemd .mount over fstab replacement for DO volumes`. Discovered during 3.10 inspection that DigitalOcean mounts the volume via a systemd `.mount` unit, not fstab; rewrote 3.10 to verify the existing mechanism rather than replace it with fstab, and updated the RUNBOOK to reflect the correct reattach procedure. Local commit only — not pushed.

### 3.10 — Verify DO volume mount survives reboot (Claude-executed, 2026-04-22)

**Approach revised mid-execution.** Original plan was "convert fstab `/dev/sda` line to `UUID=`". Inspection revealed there IS no `/dev/sda` line in fstab — DO mounts the volume via a systemd `.mount` unit at `/etc/systemd/system/mnt-volume_nyc1_1776773233539.mount`:
```
[Mount]
What=/dev/disk/by-uuid/ef4df794-37a2-4545-8153-1f1739707241
Where=/mnt/volume_nyc1_1776773233539
Options=defaults,nofail,discard,noatime
Type=ext4
[Install]
WantedBy = multi-user.target
```
Already UUID-based, already enabled, already includes `nofail`. Operator chose option X (do nothing on disk; document + verify) over option Y (replace with fstab). Plan amended in commit `dda5149` above.

**Step 1: cleanup no-op fstab backup.** Earlier 3.10 attempt left `/etc/fstab.bak-pre-knuco-uuid` from a no-op sed (no `/dev/sda` line existed to replace). md5 comparison confirmed backup was byte-identical to current fstab (`82e7363405c5458c452afd96381023d8`); backup removed via `sudo rm /etc/fstab.bak-pre-knuco-uuid`.

**Step 2: pre-reboot verification.**
- `systemctl is-active mnt-volume_nyc1_1776773233539.mount` → `active`
- `systemctl is-enabled mnt-volume_nyc1_1776773233539.mount` → `enabled`
- `findmnt /mnt/volume_nyc1_1776773233539 -o TARGET,SOURCE,FSTYPE,OPTIONS,FSROOT`:
  ```
  /mnt/volume_nyc1_1776773233539 /dev/sda ext4 rw,noatime,discard /
  ```
- Volume contents: only `lost+found/` (ready for Postgres data dir in 3.13).

**Step 3: reboot test.** Pre-reboot `boot_id=9eaa6322-8565-46d6-aab0-a29349de4049`; issued `sudo reboot` as knuco (NOPASSWD); polled until `boot_id` changed; post-reboot `boot_id=30ea17da-d242-497a-8e21-e52439da02ac` after 2 poll attempts (~10 s).

**Post-reboot verification (all checks passed):**
- `uptime -p`: `up 0 minutes`; boot time `2026-04-22 09:02:49 UTC`
- `systemctl is-active mnt-volume_nyc1_1776773233539.mount` → `active` ✓
- `systemctl is-enabled mnt-volume_nyc1_1776773233539.mount` → `enabled` ✓
- `findmnt`: identical to pre-reboot (same source `/dev/sda`, same options `rw,noatime,discard`)
- Volume contents: identical (`lost+found/` only, sizes match)
- `swapon --show`: `/swapfile 2G prio -2` ✓
- `ufw status verbose`: `Status: active`, default-deny + 22/80/443 allow ✓
- `systemctl is-system-running`: `running`, 0 failed units
- `systemctl is-active ssh`: `active` ✓

#### Benign kernel bump during 3.10 reboot

| | Pre-reboot | Post-reboot |
| --- | --- | --- |
| `uname -r` | `6.8.0-71-generic` | `6.8.0-110-generic` |

**Cause:** `unattended-upgrades` ran during the ~14-hour gap between 3.1's reboot (2026-04-21 ~19:05 UTC) and 3.10's reboot (2026-04-22 09:02 UTC); during that window it installed `linux-image-6.8.0-110-generic` (same-major, same-HWE-series security-patch kernel update). The 3.10 reboot then picked up the new kernel.

**All services survived reboot** (volume mount unit, swap, UFW, ssh, fail2ban via subsequent commands, zero failed units). **Expected behavior on droplets with `unattended-upgrades` enabled — not a regression.** Per operator decision (2026-04-22), kernel-version-bump-across-reboot is benign-and-note-it going forward, not a halt condition, unless a load-bearing service fails post-reboot. Captured as durable feedback in `~/.claude/projects/.../memory/feedback_infra_approval_gates.md`.

### 3.11 — Node 22 LTS via NodeSource + apt-mark hold (Claude-executed, 2026-04-22)

- `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` configured `/etc/apt/sources.list.d/nodesource.sources` (deb822 format) and added the NodeSource GPG key. Output: `Repository configured successfully`.
- `sudo apt-get install -y nodejs` succeeded. needrestart reported "no services need restart".
- `sudo apt-mark hold nodejs` → `nodejs set on hold` (prevents unattended-upgrades from inadvertently jumping to a different major version).
- Verify:
  - `node --version` → `v22.22.2` (Node 22 Active LTS)
  - `npm --version` → `10.9.7`
  - `command -v node` / `command -v npm` → `/usr/bin/node` / `/usr/bin/npm`
  - `apt-mark showhold` → `nodejs`
  - `dpkg -l nodejs` → `hi  nodejs  22.22.2-1nodesource1 amd64` (`hi` = hold + installed; package source confirmed as NodeSource, not Ubuntu's repo).

### 3.12 — PostgreSQL 16 from PGDG (Claude-executed, 2026-04-22)

- `sudo apt-get install -y postgresql-common` — already installed (no-op).
- `sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y` configured `/etc/apt/sources.list.d/pgdg.sources` and ran `apt-get update`. Output: "You can now start installing packages from apt.postgresql.org."
- `sudo apt-get install -y postgresql-16` succeeded. debconf "falling back to frontend: Teletype" warnings are normal for non-interactive ssh (no controlling tty); no errors.
- Verify:
  - `systemctl status postgresql --no-pager`: `active (exited)` — the wrapper service.
  - `systemctl is-active postgresql@16-main`: `active` — the actual running cluster.
  - `systemctl is-enabled postgresql`: `enabled` (auto-starts on boot).
  - `sudo -u postgres psql -c "SELECT version();"` → `PostgreSQL 16.13 (Ubuntu 16.13-1.pgdg24.04+1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit` — **same point release as local Homebrew (16.13)**.
  - `pg_lsclusters`: `16/main`, port 5432, online, owner postgres, data dir `/var/lib/postgresql/16/main` (default location; will move to `/mnt/volume_nyc1_1776773233539/postgres/main` in 3.13).
  - `dpkg -l postgresql-16` → `ii  postgresql-16  16.13-1.pgdg24.04+1 amd64`.
  - `apt-cache policy postgresql-16` → only PGDG repo provides this version (priority 500); not installed from Ubuntu's noble repo.

### Phase 3 status as of end of 3.12

- 3.1–3.12 complete. State on droplet: ~171+ packages upgraded (post-3.1 + unattended-upgrades since); current kernel `6.8.0-110-generic`; locale `en_US.UTF-8`; 2 GB swap; UFW active with 22/80/443 allow + default-deny; fail2ban running with active sshd jail and operator-IP `98.211.166.106` whitelisted; knuco user (uid 1000) with NOPASSWD sudo + key auth; sshd hardened (no root login, no password auth); SSH alias `knuco-droplet` resolves to knuco user; DO-managed volume `.mount` unit verified reboot-survival (UUID-based, nofail, enabled); **Node 22.22.2 + npm 10.9.7 installed via NodeSource and apt-marked hold**; **PostgreSQL 16.13 from PGDG installed and running on default data dir** (cluster `16/main` on port 5432).
- Working tree: MIGRATION_LOG.md modified (this section), uncommitted (will commit immediately after this entry). Plan amendments already committed separately as `dda5149`.
- **Pre-3.13 DigitalOcean snapshot remains mandatory** per the §13 go/no-go checklist before operator authorizes 3.13 (Postgres data-dir move to volume — destructive in case of misconfiguration).
- Next: pause for operator's Batch A review and pre-3.13 snapshot, then `APPROVED — 3.13`.

### Pre-3.13 DigitalOcean snapshot — operator-confirmed (2026-04-22)

Operator took manual DO snapshot before authorizing 3.13:
- Snapshot ID: `KNUCO-1776849230023` (DO-internal); operator-friendly name: `knuco-pre-3.13-postgres-data-move-2026-04-22`
- Status: Complete (verified in DO panel)
- After snapshot Complete, operator posted `APPROVED — 3.13`.

### 3.13 — Postgres data-dir move to block-storage volume (Claude-executed, 2026-04-22)

Three phases per operator-specified gate structure (separate approval between each).

**Phase 1: stop, verify, rsync, diff.**
- First attempt aborted partway due to a bash scripting bug: `set -e` + `systemctl is-active <stopped service>` returned exit 3 (systemd's normal "inactive" exit code), terminating the script before any output. `sudo systemctl stop postgresql` had already succeeded; nothing else changed. Operator authorized retry with `is-active` wrapped in `|| true` + `case` match on the string output rather than relying on exit code (rule now also documented in the kernel-bump feedback memory entry, generalized to any systemctl/similar invocation under `set -e`).
- Second attempt aborted on a self-matching `pgrep -fa "/usr/lib/postgresql/16/bin/postgres"` — the bash command line containing the literal binary path matched the pgrep regex against itself. Removed the pgrep belt-and-suspenders entirely; systemd `is-active` is the authoritative source for postgres being stopped.
- Third attempt clean. Outcome:
  - Volume verified mounted (`/mnt/volume_nyc1_1776773233539`) with only `lost+found/` present (safe to use).
  - `sudo install -d -o postgres -g postgres -m 700 /mnt/volume_nyc1_1776773233539/postgres` created the parent dir.
  - `sudo rsync -aXS --info=stats /var/lib/postgresql/16/main/ /mnt/volume_nyc1_1776773233539/postgres/main/` — sent **40,480,827 bytes** (~40 MB), received 18,558 bytes, speedup 1.00, no errors.
  - `sudo diff -rq` between source and dest: **`DIFF_OK — no differences whatsoever`** (empty output).
  - Note on `du -sh` size discrepancy (39M source vs 28M dest): caused by `rsync -S` recreating sparse holes at destination — postgres pre-allocates large segment files that are mostly zero until written. Content is byte-identical per `diff -rq`. Not data loss; in fact saves ~11 MB on the volume.

**Phase 2: postgresql.conf edit + mv old data dir + start + verify.**
- `sudo cp /etc/postgresql/16/main/postgresql.conf /etc/postgresql/16/main/postgresql.conf.bak-pre-volume-move-2026-04-22` (30,136 bytes; root:root via sudo).
- Stdin-fed Python heredoc replaced the `data_directory` line with `'/mnt/volume_nyc1_1776773233539/postgres/main'`; Python returned `OK: data_directory line replaced` and confirmed it wasn't a no-op (would have raised SystemExit(1) otherwise).
- `sudo grep "^data_directory" /etc/postgresql/16/main/postgresql.conf` → `data_directory = '/mnt/volume_nyc1_1776773233539/postgres/main'` ✓
- `sudo mv /var/lib/postgresql/16/main /var/lib/postgresql/16/main.old-pre-volume-move-2026-04-22` (NOT deleted; kept for 7-day rollback per plan).
- `sudo systemctl start postgresql` → wrapper `active`, cluster `postgresql@16-main active`.
- `sudo -u postgres psql -tAc "SHOW data_directory;"` → `/mnt/volume_nyc1_1776773233539/postgres/main` (MATCH ✓).
- Smoke-test query: `current_user=postgres`, `current_database=postgres`, `pg_postmaster_start_time=2026-04-22 09:28:44+00` (matches post-mv start).
- `sudo pg_lsclusters` confirms cluster `16/main port 5432 online postgres /mnt/volume_nyc1_1776773233539/postgres/main /var/log/postgresql/postgresql-16-main.log`.

**Phase 3: reboot test + post-reboot verification.**
- Pre-reboot `boot_id=30ea17da-d242-497a-8e21-e52439da02ac`, kernel `6.8.0-110-generic`.
- `sudo reboot` issued; reconnected with new boot_id `d20f8c2e-bee3-4231-842a-f6d88cadec6c` after **1 poll attempt** (~5 s).
- `postgresql@16-main` came up on its own after **1 poll attempt** (~1 s post-reconnect).
- Post-reboot verification (all checks passed):
  - `uptime -p`: `up 0 minutes`; boot time `2026-04-22 09:32:03 UTC`.
  - `systemctl is-system-running`: `running`, **0 failed units**.
  - All configured services `active`: `ssh`, `ufw`, `fail2ban`, `mnt-volume_nyc1_1776773233539.mount`, `postgresql`, `postgresql@16-main`.
  - Swap: 2.0 GiB active (from /swapfile).
  - UFW: active (default deny + 22/80/443 allow).
  - fail2ban sshd `ignoreip` still contains `127.0.0.0/8`, `98.211.166.106`, `::1` — operator-IP whitelist file in `/etc/fail2ban/jail.d/` survived reboot as expected.
  - Volume mount: `/mnt/volume_nyc1_1776773233539 /dev/sda ext4 rw,noatime,discard` — identical to pre-reboot.
  - Old data dir still present at `/var/lib/postgresql/16/main.old-pre-volume-move-2026-04-22` (rollback insurance).
  - Current data dir on volume: `/mnt/volume_nyc1_1776773233539/postgres/main` (postgres:postgres, 19 entries, dated 09:32 — matches post-start state).
  - `SHOW data_directory` → `/mnt/volume_nyc1_1776773233539/postgres/main` (post-reboot MATCH ✓).
  - Smoke-test query post-reboot succeeded; `pg_postmaster_start_time = 2026-04-22 09:32:10+00` (postgres started ~7 s after boot at 09:32:03).
- Kernel comparison: pre `6.8.0-110-generic`, post `6.8.0-110-generic` — **no kernel bump** this reboot (~3 min gap; no new unattended-upgrades cycle in between).

**3.13 status:** complete. Postgres now serves from the 10 GB DigitalOcean Block Storage volume at `/mnt/volume_nyc1_1776773233539/postgres/main`; data dir survived a reboot; cluster registry agrees; smoke queries pass.

**Rollback artifacts on disk** (delete after 7 days of stable production at the operator's discretion):
- `/var/lib/postgresql/16/main.old-pre-volume-move-2026-04-22` (~39 MB, original data dir on root disk)
- `/etc/postgresql/16/main/postgresql.conf.bak-pre-volume-move-2026-04-22` (30,136 bytes, original conf with `data_directory = '/var/lib/postgresql/16/main'`)
- DO snapshot `KNUCO-1776849230023` / `knuco-pre-3.13-postgres-data-move-2026-04-22` (whole-droplet, retain per operator policy)

Phase 3 progress: **3.1–3.13 done**. Remaining Batch C: 3.14 (knuco DB + knuco_app DB user with strong password to 1Password), 3.15 (Nginx install), 3.16 (Certbot install), 3.17 (application directory structure). Awaiting operator's `APPROVED — Batch C`.

### 3.14 — knuco DB + knuco_app DB user (Claude-executed, two calls, 2026-04-22)

Operator split off 3.14 from Batch C ("password-capture ceremony deserves my full attention; I don't want to juggle other step outputs while I'm copying a secret into 1Password"). Approved 3.14 alone; 3.15–3.17 to be authorized as a separate batch after 3.14 lands cleanly.

**Two-call adaptation of the planned `read -p` ceremony.** The original 3.14 plan had `read -p "Press Enter ONLY after the password is saved..."` between display and CREATE USER, gating DB creation behind operator's 1Password save. Claude Code's Bash tool runs non-interactive bash without a TTY, so `read -p` either returns immediately or hangs until tool-timeout. Adapted: split into two bash calls, password persisted between them via a mode-600 temp file at `/tmp/knuco_dbpass.tmp` (since shell vars don't survive across Bash tool invocations). Operator confirmed save in-thread before authorizing Call 2.

**Call 1 — password generation + display + temp file:**
- History hygiene: `HISTCONTROL=ignorespace`, `HISTFILE=/dev/null` (symbolic in non-interactive bash but per spec).
- Password generated via `openssl rand -base64 32 | tr -d '/+=' | cut -c1-32` — leading-space convention applied. 32 bytes, base64 alphabet minus `/+=` (no SQL-quoting hazards).
- Written to `/tmp/knuco_dbpass.tmp` (laptop) with `umask 077; printf '%s' "$PGPASS" > ...` — mode 600, owner `legalassistant:wheel`, no trailing newline, exactly 32 bytes.
- Printed to tool output per operator's literal spec.
- **Conversation-log capture caveat flagged to operator before Call 1 ran:** Claude Code's Bash tool output is captured into the local conversation transcript (`~/.claude/projects/-Users-legalassistant-constructioncrm/`), so `echo "$PGPASS"` deposits the password there in addition to terminal scrollback. Operator accepted the trade-off (local-disk only, user-permission restricted, equivalent threat-model to terminal scrollback).
- Operator saved password to 1Password vault item `KNUCO prod DB — knuco_app`, verified by reopening the entry and matching character count.

**Call 2 — DB creation + verification + shred:**
- `ssh knuco-droplet 'sudo -u postgres psql -v ON_ERROR_STOP=1' <<SQL ... SQL` — heredoc with command-substituted password from `$(cat /tmp/knuco_dbpass.tmp)`, piped into ssh stdin (psql receives via sudo's stdin forwarding). Password never appears in argv on either side. Local heredoc terminator unquoted so `$(cat ...)` expands locally.
- Output: `CREATE ROLE` / `CREATE DATABASE` / `GRANT` — all succeeded with no errors (ON_ERROR_STOP would have aborted on any).
- Verification 3a (role exists, no password exposure): `SELECT rolname FROM pg_roles WHERE rolname = 'knuco_app';` returned `knuco_app` (1 row) ✓
- Verification 3b (database + owner): `SELECT datname, pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'knuco';` returned `knuco | knuco_app` (1 row) ✓
- `/tmp/knuco_dbpass.tmp` removal: macOS doesn't ship `shred` or `gshred` (no GNU coreutils installed via Homebrew). Fallback: `dd if=/dev/urandom of=/tmp/knuco_dbpass.tmp bs=32 count=1 conv=notrunc` (overwrite with random bytes), then `rm`. File confirmed gone via `ls`.
- **Honest caveat noted in report:** on APFS (modern macOS), copy-on-write semantics mean the original physical SSD blocks may not be overwritten despite the `dd`; secure-delete is largely cosmetic on Mac SSDs. The file is unlinked and overwritten at the FS layer; SSD controller GC eventually reclaims. The redundant copies in 1Password + conversation log + terminal scrollback dominate the threat model. `brew install coreutils` would provide `gshred` for stronger semantics in future password-handling steps.

**Where the password lives now:**
- 1Password vault: item `KNUCO prod DB — knuco_app` (operator's canonical copy)
- Claude Code conversation transcript on the laptop
- Operator's terminal scrollback (transient)
- PostgreSQL on droplet: hashed in `pg_authid.rolpassword` (SCRAM-SHA-256, the cluster's default password hash)
- **Not yet** in `/etc/knuco/env` on the droplet — added during 4.4 env assembly.

**DATABASE_URL shape for 4.4:** `postgresql://knuco_app:<PGPASS>@127.0.0.1:5432/knuco?schema=public` (replace `<PGPASS>` with the 1Password value at env-assembly time).

**3.14 status:** complete. Working tree: MIGRATION_LOG.md modified (this section, uncommitted; will batch with 3.15/3.16/3.17 entries per operator instruction).

Phase 3 progress: **3.1–3.14 done**. Remaining: 3.15 (Nginx install), 3.16 (Certbot install), 3.17 (application directory structure). Awaiting operator's `APPROVED — 3.15/3.16/3.17 batch`.

### 3.15 — Nginx install (Claude-executed, 2026-04-22)

- `sudo apt-get install -y nginx` succeeded; needrestart reported nothing to restart.
- `sudo systemctl enable --now nginx` ran SysV-script sync; nginx active + enabled (auto-starts on boot).
- `systemctl is-active nginx` → `active` ✓; `systemctl is-enabled nginx` → `enabled` ✓
- nginx version: `nginx/1.24.0 (Ubuntu)` from Ubuntu's apt repo.
- **Droplet-side** `curl -sI http://127.0.0.1/` → `HTTP/1.1 200 OK`, Content-Length 615 (default Nginx welcome page from the package). Confirms nginx listening on port 80 internally.
- **Laptop-side canary** `curl -sI --max-time 10 http://161.35.0.183/` → `HTTP/1.1 200 OK` (HTTP_CODE 200). Confirms UFW allow-rule for 80/tcp (from 3.4) is in effect AND nginx is reachable from the public internet. Both sides match — same Server header, same ETag, same Content-Length.
- Default Nginx vhost is the only site enabled at this point. KNUCO vhost (proxy_pass to 127.0.0.1:4000) is added in step 5.2.

### 3.16 — Certbot install (Claude-executed, 2026-04-22)

- `sudo apt-get install -y certbot python3-certbot-nginx` succeeded; needrestart reported nothing to restart.
- `certbot --version` → `certbot 2.9.0` (Ubuntu 24.04 apt distribution; expected 2.x).
- Package versions: `ii certbot 2.9.0-1`, `ii python3-certbot-nginx 2.9.0-1`. Binary at `/usr/bin/certbot`.
- `systemctl list-unit-files | grep certbot` → `certbot.service static`, `certbot.timer enabled enabled`. The renewal timer is enabled at package-install time; it exits cleanly without doing anything until a cert exists. (Note: this is **certbot 2.x behavior** — earlier 1.x versions only created the timer after the first successful `certbot run`. The original MIGRATION_PLAN.md may carry the older assumption in places; benign discrepancy noted for future operators.)
- **No cert acquired in this step** — 3.16 is install-only. First cert acquisition is step 5.4, after operator adds the DNS A record for `crm.knuconstruction.com → 161.35.0.183` at GoDaddy.

### 3.17 — Application directory structure (Claude-executed, 2026-04-22)

Created 6 directories with knuco:knuco ownership and per-spec modes via `sudo install -d`. All 6 verified via `ls -ld`:

| Path | Spec | Actual | Match |
| --- | --- | --- | --- |
| `/opt/knuco` | knuco:knuco 755 | `drwxr-xr-x 2 knuco knuco` | ✓ |
| `/etc/knuco` | knuco:knuco 750 | `drwxr-x--- 2 knuco knuco` | ✓ |
| `/var/log/knuco` | knuco:knuco 750 | `drwxr-x--- 2 knuco knuco` | ✓ |
| `/var/backups/knuco` | knuco:knuco 750 | `drwxr-x--- 2 knuco knuco` | ✓ |
| `/var/lib/knuco` | knuco:knuco 755 | `drwxr-xr-x 3 knuco knuco` (link-count 3 from uploads subdir) | ✓ |
| `/var/lib/knuco/uploads` | knuco:knuco 700 | `drwx------ 2 knuco knuco` | ✓ |

No symlinks, no incorrect owner, no incorrect mode. The plan spec is met exactly.

### Phase 3 complete (3.1–3.17 all done) — droplet state summary as of 2026-04-22

- **OS:** Ubuntu 24.04.3 LTS, kernel `6.8.0-110-generic` (post-3.10 reboot picked up unattended-upgrades' security kernel), routine apt updates applied.
- **Locale:** `en_US.UTF-8`.
- **Swap:** 2 GiB at `/swapfile`, `vm.swappiness=10`, persisted via `/etc/fstab` and `/etc/sysctl.d/99-knuco-swap.conf`.
- **UFW:** active, default deny incoming + allow outgoing, allow rules for 22/80/443 (v4 + v6).
- **fail2ban:** active with sshd jail; operator-IP whitelist `127.0.0.0/8 ::1 98.211.166.106` in `/etc/fail2ban/jail.d/knuco-whitelist.local`.
- **Users:** `root` (no SSH access via password or key after 3.8 hardening; only via QEMU console) + `knuco` (uid 1000, key-only SSH, NOPASSWD:ALL sudo).
- **sshd:** `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `ChallengeResponseAuthentication no`, `PubkeyAuthentication yes`, `PermitEmptyPasswords no`, `MaxAuthTries 3`, `LoginGraceTime 30`, port 22.
- **SSH alias** `knuco-droplet` → `knuco@161.35.0.183` with `IdentityFile ~/.ssh/knuco_do_ed25519`, `IdentitiesOnly yes`, `UseKeychain yes`, `AddKeysToAgent yes`.
- **Volume mount:** DO-managed `mnt-volume_nyc1_1776773233539.mount` unit, UUID-based (`/dev/disk/by-uuid/ef4df794-37a2-4545-8153-1f1739707241`), `Options=defaults,nofail,discard,noatime`, enabled into multi-user.target.wants/. NOT in fstab (per 3.10 amendment).
- **PostgreSQL 16.13** (pgdg24.04+1): cluster `16/main` on port 5432, data dir `/mnt/volume_nyc1_1776773233539/postgres/main` (on the volume per 3.13), knuco DB exists owned by knuco_app DB role with strong password (in 1Password vault as `KNUCO prod DB — knuco_app`). Connection string shape: `postgresql://knuco_app:<PGPASS>@127.0.0.1:5432/knuco?schema=public`.
- **Node 22.22.2** + npm 10.9.7 (NodeSource, `apt-mark hold` against unattended-upgrades).
- **Nginx 1.24.0** (Ubuntu apt): default site responds on port 80 from internet (`200 OK` from laptop-side curl). KNUCO vhost added in 5.2.
- **Certbot 2.9.0** + `python3-certbot-nginx` 2.9.0 installed; renewal timer enabled. No cert yet (5.4).
- **App dirs:** `/opt/knuco` (755), `/etc/knuco` (750), `/var/log/knuco` (750), `/var/backups/knuco` (750), `/var/lib/knuco` (755), `/var/lib/knuco/uploads` (700) — all knuco:knuco.
- **Rollback artifacts** still present (delete after 7 days of stable production at operator's discretion):
  - `/var/lib/postgresql/16/main.old-pre-volume-move-2026-04-22` (~39 MB, original Postgres data dir on root disk)
  - `/etc/postgresql/16/main/postgresql.conf.bak-pre-volume-move-2026-04-22` (30,136 bytes, original conf)
  - `/root/sshd-config-backup-pre-phase3/` (original sshd_config + drop-ins from 3.8)
  - `/etc/postgresql/16/main/postgresql.conf.bak` (sed -i.bak from 3.13 phase 2 — minor, can delete sooner)
  - DO snapshot `KNUCO-1776849230023` / `knuco-pre-3.13-postgres-data-move-2026-04-22`

**Phase 3 exit criteria** per plan section "Phase 3 exit criteria": final reboot test pending operator authorization. Confirms ALL configured services come back from a cold boot — most things have already been individually tested across 3.1, 3.10, 3.13 reboots, but the wrap-up reboot is the one that proves the entire post-3.17 state is reboot-survivable end-to-end.

Standing by for `APPROVED — phase 3 final reboot test` (or equivalent), then we proceed to Phase 4 (transfer).

### Phase 3 exit-criteria reboot test (Claude-executed, 2026-04-22 ~10:04 UTC)

Operator authorized the final wrap-up reboot. Pre-reboot snapshot captured all configured services + UFW + Postgres data dir + volume mount + swap + knuco user; reboot issued; post-reboot snapshot re-captured every check.

**Reboot timing:** boot_id changed `d20f8c2e-bee3-4231-842a-f6d88cadec6c` → `c91bbd01-bd65-47f7-9bb6-6b25050d9de3` after 1 poll attempt (~5s). `postgresql@16-main` came up after 1 additional poll attempt (~1s). Boot time `2026-04-22 10:04:11 UTC`.

**Kernel:** `6.8.0-110-generic` pre = post — no kernel bump this reboot (only ~30 min gap since 3.13's reboot, no unattended-upgrades cycle in between).

**Post-reboot service status — all green:**
- `systemctl is-system-running`: `running`, **0 failed units**.
- `systemctl is-active`:
  - `postgresql` → `active`
  - `postgresql@16-main` → `active`
  - `nginx` → `active`
  - `ssh` → `active`
  - `fail2ban` → `active`
  - `ufw` → `active`
  - `mnt-volume_nyc1_1776773233539.mount` → `active`
- `systemctl is-enabled`:
  - `postgresql` → `enabled`
  - `nginx` → `enabled`
  - `fail2ban` → `enabled`
  - `ssh` → **`disabled`** (this is correct on Ubuntu 24.04 — `ssh` ships as socket-activated; `ssh.socket` is enabled and listens on 22, and `ssh.service` is started on demand by the socket. `is-enabled ssh.service = disabled` does NOT mean SSH won't come up at boot. Verified by the fact that we successfully SSH'd back in immediately post-reboot. To audit the socket directly: `systemctl is-enabled ssh.socket`.)

**Post-reboot config + state checks:**
- `ufw status verbose`: active, default deny + 22/80/443 allow (v4 + v6) — same as pre-reboot.
- `fail2ban-client get sshd ignoreip`: `127.0.0.0/8`, **`98.211.166.106`** (operator IP), `::1` — whitelist file in `/etc/fail2ban/jail.d/` survived reboot.
- `SHOW data_directory` (psql as postgres) → `/mnt/volume_nyc1_1776773233539/postgres/main` ✓
- `findmnt /mnt/volume_nyc1_1776773233539`: `/dev/sda ext4 rw,noatime,discard` — identical to pre-reboot.
- `swapon --show`: `/swapfile 2G prio -2` — same as pre-reboot.
- `id knuco`: `uid=1000(knuco) gid=1000(knuco) groups=1000(knuco),27(sudo),100(users)` — same as before.

**Postgres sanity query (against the `knuco` database):**
```sql
SELECT version();              -- PostgreSQL 16.13 (Ubuntu 16.13-1.pgdg24.04+1) ...
SELECT current_database(),     -- knuco
       current_user;           -- postgres
```
Both queries returned expected values; the `knuco` DB is reachable, the cluster is healthy, the data dir on the volume is being used.

**Laptop-side external reachability canary post-reboot:**
- `curl -sI --max-time 10 http://161.35.0.183/` → `HTTP/1.1 200 OK`, same `Server: nginx/1.24.0 (Ubuntu)`, same `ETag: "69e89b5c-267"`, same `Last-Modified` as the pre-3.15-reboot capture. Confirms UFW allow-rule for 80/tcp + nginx + DigitalOcean edge routing all clean post-reboot. Internet → droplet path is exercised end-to-end.

**Rollback artifacts confirmed still present:**
- `/var/lib/postgresql/16/main.old-pre-volume-move-2026-04-22` — postgres:postgres, 19 entries, original Postgres data dir
- `/etc/postgresql/16/main/postgresql.conf.bak-pre-volume-move-2026-04-22` — root:root, 30,136 bytes
- `/root/sshd-config-backup-pre-phase3/sshd_config` (3486 bytes — original from 3.8) + `sshd_config.d/50-cloud-init.conf` (27 bytes) + `sshd_config.d/60-cloudimg-settings.conf` (26 bytes) — verified via `sudo ls -la` after the initial `ls` failed with permission denied (knuco can't read `/root/`; backup is owned by root)
- DO snapshot `KNUCO-1776849230023` / `knuco-pre-3.13-postgres-data-move-2026-04-22`

**Phase 3 status: complete and reboot-survived.** Droplet is in the stable post-Phase-3 state described above. Ready for Phase 4 (transfer) — pending operator's `APPROVED — proceed to Phase 4`.
