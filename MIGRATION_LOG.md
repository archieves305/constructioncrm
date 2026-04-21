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
