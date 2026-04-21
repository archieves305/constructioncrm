# KNUCO Migration Plan — Phase 2

Generated: 2026-04-21 (America/New_York). **Plan only — no execution.** Phase 3 begins only after user posts `APPROVED — proceed to Phase 3` and the go/no-go checklist (section 13) is fully ticked.

Each Phase 3+ step includes: action, exact command(s), verification check, rollback. Steps run sequentially with explicit per-step approval per the operating rules from the original prompt.

---

## 1. Goal and scope

Migrate the KNUCO CRM (Next.js 16.2.3 + Prisma 7.7.0 + PostgreSQL 16 + NextAuth 4) from `/Users/legalassistant/constructioncrm` on the laptop to a production environment on the DigitalOcean droplet at `161.35.0.183`, exposed at `https://crm.knuconstruction.com`. End state must support an ongoing develop-locally → deploy-to-prod workflow via a laptop-side rsync deploy script.

### In scope

- Droplet OS hardening (apt upgrade, swap, UFW, key-only SSH, fail2ban, SSH-config dedup)
- Runtime install (Node 22 LTS, PostgreSQL 16 from PGDG with data dir on the 10 GB block volume, Nginx, certbot)
- Code transfer (rsync), production build (`prisma generate` + `next build`), `prisma migrate deploy`, reduced reference-data seed, single ADMIN user
- systemd unit for the app, Nginx reverse proxy with TLS via Let's Encrypt, logrotate, nightly DB dump with retention
- `deploy.sh` for ongoing iteration

### Out of scope this pass (deferred per Q answers)

- Outlook email-intake automation (Q3 deferred — manual trigger only)
- File-uploads storage backend (Q4 — directory created but no code wiring)
- Tailscale on droplet (post-Phase-8 hardening)
- HSTS `preload` re-add (post 6 months stable prod)
- DigitalOcean Managed Database migration (revisit if/when droplet outgrows local Postgres)
- FileVault on laptop (non-blocking pre-cutover TODO)

---

## 2. Target architecture

### 2.1 Droplet filesystem layout

| Path | Owner | Mode | Purpose |
| --- | --- | --- | --- |
| `/opt/knuco/` | `knuco:knuco` | 755 | Application code (rsync target) |
| `/etc/knuco/env` | `knuco:knuco` | 600 | Production env vars (referenced by systemd `EnvironmentFile=`) |
| `/var/log/knuco/` | `knuco:knuco` | 750 | Reserved (app logs to journald; this dir for any future file logs) |
| `/var/backups/knuco/` | `knuco:knuco` | 750 | Nightly DB dumps + retention |
| `/var/lib/knuco/uploads/` | `knuco:knuco` | 700 | Empty per Q4; no code wiring this pass |
| `/mnt/volume_nyc1_1776773233539/postgres/main/` | `postgres:postgres` | 700 | PostgreSQL data dir, on the 10 GB block-storage volume per Q13 |
| `/etc/systemd/system/knuco.service` | `root:root` | 644 | systemd app unit |
| `/etc/systemd/system/knuco-backup.{service,timer}` | `root:root` | 644 | Nightly backup |
| `/etc/nginx/sites-available/knuco` + symlink in `sites-enabled` | `root:root` | 644 | Nginx vhost |
| `/etc/ssh/sshd_config.d/00-knuco-hardening.conf` | `root:root` | 644 | SSH hardening |
| `/etc/sudoers.d/knuco` | `root:root` | 440 | knuco user sudo |
| `/swapfile` | `root:root` | 600 | 2 GB swap |
| `/usr/local/bin/knuco-backup.sh` | `root:knuco` | 750 | Backup script |

### 2.2 User accounts on the droplet

- `root` — locked down to key-auth only after Phase 3.8; `PermitRootLogin no` after `knuco` user verified working from a fresh terminal. Backup access remains via DO web console.
- `knuco` — system user, member of `sudo` group, no Unix password (key-only). Owns `/opt/knuco`, `/etc/knuco`, `/var/log/knuco`, `/var/backups/knuco`, `/var/lib/knuco`. Same SSH pubkey as installed on root in Phase 1 (`knuco-do-deploy 2026-04-21`).
- `postgres` — system user from Postgres install, owns the data dir on the volume.

### 2.3 Service decomposition

| Service | Purpose | Env source | Notes |
| --- | --- | --- | --- |
| `postgresql.service` | DB (Postgres 16, data dir on volume) | system | Standard PGDG install |
| `knuco.service` | Next.js app | `EnvironmentFile=/etc/knuco/env` | `User=knuco`, binds `127.0.0.1:4000` only |
| `nginx.service` | TLS reverse proxy | system | `127.0.0.1:4000` upstream |
| `fail2ban.service` | sshd jail (5 fails / 10 min) | system | Default config sufficient |
| `unattended-upgrades.service` | Security patches | already enabled | Manual one-shot upgrade in Phase 3.1 to drain backlog |
| `certbot.timer` | TLS renewal | system | Auto from `certbot --nginx` |
| `knuco-backup.timer` | Nightly DB dump | system | Custom; runs `knuco-backup.sh` |

### 2.4 Network / TLS

- DNS: `crm.knuconstruction.com` `A` → `161.35.0.183`, TTL 300 initially (raise to 3600 after 7 days stable). Created at GoDaddy by user before Phase 5.4.
- Public ports (UFW allow): 22 (SSH), 80 (HTTP for ACME challenge + nginx redirect), 443 (HTTPS). Default deny otherwise.
- Nginx vhost: 80 → 301 to 443; 443 → proxy_pass `127.0.0.1:4000` with `X-Forwarded-*` headers, `client_max_body_size 25M`, `gzip on`, `location ~ /\.` deny block (blocks `.git/`, `.env`, etc.).
- App binds `127.0.0.1:4000` only via `next start -p 4000 -H 127.0.0.1`; not directly reachable from the internet even if UFW/Nginx are misconfigured.

### 2.5 Storage layout decision (Q13)

- **PostgreSQL data dir** moves to `/mnt/volume_nyc1_1776773233539/postgres/main` on the 10 GB block-storage volume. Volume mounted via `/etc/fstab` by UUID for reboot safety. Procedure in 3.13.
- **Application code, env, backups, logs, uploads dir** stay on the 120 GB root disk.
- **Trade-offs accepted:** volume snapshots are separate from droplet snapshots — backup procedure (Phase 5.6) covers DB dumps independently. Volume can be detached + reattached to a rebuilt droplet (procedure in RUNBOOK Phase 8). Local DB is ~KB-sized; 10 GB is years of headroom; can grow online via DO panel without downtime.

### 2.6 Backups

- **Nightly:** `pg_dump -Fc` to `/var/backups/knuco/postgres-YYYY-MM-DD.dump`, 14-day retention.
- **Pre-Phase snapshots:** user takes manual DigitalOcean snapshot before each major destructive step (3.1, 3.13, 4.5, 4.7, 5.4 minimum).
- **Restore procedure:** documented in Phase 8 RUNBOOK.

### 2.7 Phase 1 → Phase 2 decision matrix

| Q | Decision |
| --- | --- |
| Q1 | Local `construction_crm` is legacy. Start fresh on droplet. Local DB **untouched** (not read, not modified). |
| Q2 | Reduced seed (`scripts/seed-prod.ts`) — reference rows only. Single ADMIN user via `scripts/create-admin.ts` (one-off, idempotent). |
| Q3 | Defer Outlook intake automation. Manual trigger only at launch via admin UI. |
| Q4 | Create `/var/lib/knuco/uploads/` (chmod 700, owned by knuco). No code wiring this pass. |
| Q5 | Node 22 LTS via NodeSource, `apt-mark hold nodejs`. |
| Q6 | PostgreSQL 16 on droplet (PGDG repo). |
| Q7 | systemd. |
| Q8 | Laptop-side rsync `./deploy.sh`. |
| Q9 | HSTS without `preload`. Drop in code before Phase 4 transfer. |
| Q10 | `src/lib/env.ts` is authoritative env manifest. `.env.production` constructed fresh; no copy of dev values. |
| Q11/Q12 | Resolved (passphrase-protected key, per-repo git identity). |
| Q13 | Postgres data dir on 10 GB block-storage volume. |
| Q14 | Locale `en_US.UTF-8`. |
| Q15 | SSH on port 22. |
| Q16 | `eth1` (legacy 10.116.0.2) left untouched. |

---

## 3. Phase 3 — Droplet preparation

> **⚠ DigitalOcean console distinction — critical before Phase 3:**
>
> DigitalOcean exposes **two different web consoles**, and they behave very differently after step 3.8 sets `PasswordAuthentication=no`:
>
> 1. **"Launch Droplet Console" button** in the DO UI (Droplet → Access tab → top of page). Authenticates **via the droplet's sshd** with a DO-provided one-time-password flow. **Becomes unusable after 3.8** — sshd refuses password auth.
> 2. **QEMU virtual serial console** at the direct URL `https://cloud.digitalocean.com/droplets/<droplet_id>/console?no_layout=true`. Talks to the **hypervisor**, not to sshd. **Always works**, independent of sshd config, UFW, or fail2ban. Authenticates at the serial console prompt with the droplet's `root` password (NOT key auth).
>
> **Only the QEMU URL is a real out-of-band escape hatch after 3.8.** Bookmark it before starting Phase 3. This distinction was learned the hard way during the 2026-04-21 migration run — see MIGRATION_LOG.md § 3.8 incident for the fail2ban self-ban that required QEMU-console recovery.

Pre-flight (before any Phase 3 step runs):

- **A.** User takes a manual DigitalOcean snapshot of the droplet via the DO panel. User posts `SNAPSHOT TAKEN <snapshot-name>` in chat.
- **B.** User opens a **second SSH session** as escape hatch in a separate terminal window: `ssh knuco-droplet` and leaves it idle. Required during steps 3.4 (UFW), 3.8 (sshd hardening).
- **C.** User bookmarks the **QEMU serial console URL** (`https://cloud.digitalocean.com/droplets/<droplet_id>/console?no_layout=true`) as last-resort recovery channel. Note: the "Launch Droplet Console" button on the Access tab is **not** a safe escape hatch — it authenticates via sshd and becomes unusable after 3.8. See the warning block above.
- **D.** User posts `APPROVED — proceed to Phase 3` to authorize the entire phase. Each step still has an individual approval gate.

All Phase 3 commands run via `ssh knuco-droplet` (root via the alias, until 3.9 swaps the alias to `knuco`).

### 3.1 Apt full upgrade + reboot if kernel updated

**Action:** drain the 170-package backlog identified in Phase 1 3b. Reboot if a new kernel was installed.

**Commands:**
```
ssh knuco-droplet 'apt-get update'
ssh knuco-droplet 'DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade'
ssh knuco-droplet 'apt-get -y autoremove && apt-get -y autoclean'
ssh knuco-droplet 'test -f /var/run/reboot-required && echo REBOOT_REQUIRED || echo no_reboot'
```
If `REBOOT_REQUIRED`: `ssh knuco-droplet 'reboot'`. Wait 60s. Reconnect: `ssh knuco-droplet 'uptime && uname -r'`.

**Verify:** `ssh knuco-droplet 'apt list --upgradable 2>/dev/null | wc -l'` returns 1 (header only) or near-1.

**Rollback:** restore from pre-Phase-3 DO snapshot.

**Approval gate:** APPROVED — Phase 3.1 apt upgrade.

### 3.2 Locale bump (Q14)

**Action:** generate + activate `en_US.UTF-8`. Timezone stays `Etc/UTC`.

**Commands:**
```
ssh knuco-droplet 'locale-gen en_US.UTF-8'
ssh knuco-droplet 'update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8'
```

**Verify:** open a fresh `ssh knuco-droplet 'locale | grep ^LANG='` — returns `LANG=en_US.UTF-8`.

**Rollback:** `ssh knuco-droplet 'update-locale LANG=C.UTF-8 LC_ALL=C.UTF-8'`.

**Approval gate:** APPROVED — 3.2 locale bump.

### 3.3 Swap file (2 GB)

**Action:** add 2 GB swap, persist via `/etc/fstab`, set `vm.swappiness=10`.

**Commands:**
```
ssh knuco-droplet 'fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile'
ssh knuco-droplet 'grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab'
ssh knuco-droplet 'sysctl vm.swappiness=10 && echo "vm.swappiness=10" > /etc/sysctl.d/99-knuco-swap.conf'
```

**Verify:** `ssh knuco-droplet 'swapon --show && free -h | grep Swap'` shows 2.0 GiB.

**Rollback:** `swapoff /swapfile && rm /swapfile && sed -i '\|^/swapfile|d' /etc/fstab && rm -f /etc/sysctl.d/99-knuco-swap.conf`.

**Approval gate:** APPROVED — 3.3 swap.

### 3.4 UFW enable (allow 22/80/443, deny default)

**⚠ User must have a second SSH session open before proceeding.**

**Commands:**
```
ssh knuco-droplet 'ufw default deny incoming'
ssh knuco-droplet 'ufw default allow outgoing'
ssh knuco-droplet 'ufw allow 22/tcp comment "ssh"'
ssh knuco-droplet 'ufw allow 80/tcp comment "http (acme + nginx redirect)"'
ssh knuco-droplet 'ufw allow 443/tcp comment "https"'
ssh knuco-droplet 'ufw --force enable'
ssh knuco-droplet 'ufw status verbose'
```

**Verify:** `ufw status verbose` shows Status active and the three allow rules. Existing SSH session remains connected (UFW doesn't drop established connections). New `ssh knuco-droplet 'echo ok'` succeeds.

**Rollback (if locked out — should not happen with this order):** DO web console → `ufw disable`.

**Approval gate:** APPROVED — 3.4 UFW enable. (User confirms second session is open.)

### 3.5 fail2ban install + sshd jail + operator-IP whitelist

**Commands:**
```
ssh knuco-droplet 'apt-get install -y fail2ban'
ssh knuco-droplet 'systemctl enable --now fail2ban'

# Whitelist the operator's laptop public IP BEFORE step 3.8 runs its verification
# tests. Without this, step 3.8's 2b (root login refused) and 2c (password auth
# refused) are counted by fail2ban as auth failures against the operator IP;
# combined with any Claude-side reruns of the same tests from the same laptop,
# they cross the default 5-failure / 10-min threshold and ban the laptop.
# Recovery then requires the QEMU serial console (see section 3 header warning).
#
# Added 2026-04-21 after that exact failure mode played out live during Phase 3.

OPERATOR_IP=$(curl -s https://api.ipify.org)
echo "operator IP (will be whitelisted): $OPERATOR_IP"
[[ "$OPERATOR_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: not a valid IPv4"; exit 1; }

ssh knuco-droplet "cat > /etc/fail2ban/jail.d/knuco-whitelist.local <<EOF
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 $OPERATOR_IP
EOF"
ssh knuco-droplet 'chmod 644 /etc/fail2ban/jail.d/knuco-whitelist.local'
ssh knuco-droplet 'systemctl restart fail2ban'

ssh knuco-droplet 'fail2ban-client status sshd'
ssh knuco-droplet 'fail2ban-client get sshd ignoreip'
# Expected: ignoreip list contains 127.0.0.1/8, ::1, and the operator IP.
```

Default jail: 5 failures = 10 min ban. Operator IP is in `ignoreip`, so intentional auth-failure tests in step 3.8 will not count against the laptop.

**Verify:** `fail2ban-client status sshd` shows jail active (may show previously-banned scanner IPs under `Total banned`; that's normal). `fail2ban-client get sshd ignoreip` returns `127.0.0.1/8 ::1 $OPERATOR_IP`.

**Rollback:** `systemctl disable --now fail2ban && apt-get -y purge fail2ban && rm -f /etc/fail2ban/jail.d/knuco-whitelist.local`.

**Approval gate:** APPROVED — 3.5 fail2ban + whitelist.

### 3.6 Create knuco user with sudo + explicit SSH pubkey install

**The exact public key to install** (verbatim from `~/.ssh/knuco_do_ed25519.pub`, supplied by user):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILI3DkVYGEkX4qXHx+/RgaNH+7lxztmas17yxyPA2swM knuco-do-deploy 2026-04-21
```

**Commands:**
```
ssh knuco-droplet 'adduser --disabled-password --gecos "KNUCO app user" knuco'
ssh knuco-droplet 'usermod -aG sudo knuco'
ssh knuco-droplet 'install -d -m 700 -o knuco -g knuco /home/knuco/.ssh'

# Install the specific pubkey by content rather than cloning /root/.ssh/authorized_keys.
# Rationale: root's authorized_keys may later accumulate additional entries
# (other operators, automation keys); knuco's file should contain exactly the
# one entry we authorize here until we explicitly add more.
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILI3DkVYGEkX4qXHx+/RgaNH+7lxztmas17yxyPA2swM knuco-do-deploy 2026-04-21' \
  | ssh knuco-droplet 'install -m 600 -o knuco -g knuco /dev/stdin /home/knuco/.ssh/authorized_keys'

# Byte-compare what's on the droplet against the laptop's pubkey
LAPTOP_PUB=$(cat ~/.ssh/knuco_do_ed25519.pub)
DROPLET_PUB=$(ssh knuco-droplet 'cat /home/knuco/.ssh/authorized_keys')
[ "$LAPTOP_PUB" = "$DROPLET_PUB" ] && echo "PUBKEY MATCH" || echo "MISMATCH — investigate"
```

**Verify (from a fresh laptop terminal — required before any further step):**
```
ssh -o BatchMode=yes knuco@161.35.0.183 'echo USER_OK && whoami && id'
```
Expected: `USER_OK / knuco / uid=1000(knuco) gid=1000(knuco) groups=1000(knuco),27(sudo)`.

**Rollback:** `userdel -r knuco`.

**Approval gate:** APPROVED — 3.6 knuco user. User confirms `USER_OK` from fresh terminal AND `PUBKEY MATCH` from the byte-compare.

### 3.7 Sudo configuration for knuco

**Decision (per user, 2026-04-21): Option A — `NOPASSWD:ALL`.** The knuco user has no Unix password (`--disabled-password`); the security boundary is the passphrase-protected SSH key cached in macOS Keychain. A scoped allowlist creates real friction every time the deploy pipeline gains a new command and a single-operator setup doesn't benefit from it. **Documented in RUNBOOK § known-caveats:** revisit Option B (scoped NOPASSWD allowlist) when a second operator joins the project.

**Commands:**
```
ssh knuco-droplet 'echo "knuco ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/knuco && chmod 440 /etc/sudoers.d/knuco && visudo -c'
```

**Verify (from fresh laptop terminal):** `ssh knuco@161.35.0.183 'sudo -n true && echo SUDO_OK'` returns `SUDO_OK` with no prompt.

**Rollback:** `rm /etc/sudoers.d/knuco`.

**Approval gate:** APPROVED — 3.7 sudo (Option A, NOPASSWD:ALL).

### 3.8 Harden sshd (PermitRootLogin no, PasswordAuthentication no, dedup conflicting files)

**⚠ Second SSH session must be open.**

**Action:** write a single hardening file that takes precedence over the conflicting `sshd_config.d/*` entries discovered in Phase 1 3b. Drop-in files load alphabetically; a `00-` prefix loads first; later files (`50-cloud-init`, etc.) can still override. To be safe, also remove any conflicting directives from existing files.

**Commands:**
```
# Inspect all drop-ins first (no edits yet)
ssh knuco-droplet 'ls /etc/ssh/sshd_config.d/'
ssh knuco-droplet 'grep -REn "PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication" /etc/ssh/sshd_config.d/'

# Backup the entire drop-in directory (mandatory before any edits)
ssh knuco-droplet 'mkdir -p /root/sshd-config-backup-pre-phase3 && cp -a /etc/ssh/sshd_config.d/. /root/sshd-config-backup-pre-phase3/'

# Identify ONLY the files that actually contain conflicting directives
CONFLICT_FILES=$(ssh knuco-droplet "grep -lE '^(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication)' /etc/ssh/sshd_config.d/*.conf 2>/dev/null")
echo "Files with conflicting directives:"
printf '%s\n' "$CONFLICT_FILES"
# Common suspect on Ubuntu 24.04 base image:
#   /etc/ssh/sshd_config.d/50-cloud-init.conf  (sets PasswordAuthentication yes)
#
# PAUSE here. Report the file list to user. APPROVED to proceed only after
# user confirms which files to edit.

# Then edit ONLY those specific files (not a directory blanket-sed):
for f in $CONFLICT_FILES; do
  ssh knuco-droplet "sed -i '/^PermitRootLogin/d; /^PasswordAuthentication/d; /^KbdInteractiveAuthentication/d; /^ChallengeResponseAuthentication/d' '$f'"
  echo "  cleaned: $f"
done

# Write authoritative hardening file
ssh knuco-droplet 'cat > /etc/ssh/sshd_config.d/00-knuco-hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
EOF'

# Validate config
ssh knuco-droplet 'sshd -t && echo CONFIG_OK'

# Show effective config (should show all our hardening)
ssh knuco-droplet 'sshd -T 2>/dev/null | grep -iE "^(permitrootlogin|passwordauth|pubkeyauth|kbdint|challengeresponse|permitempty|maxauth|logingrace) "'
```

If `CONFIG_OK` and the effective config matches: `ssh knuco-droplet 'systemctl reload ssh'`.

**⚠ Pre-verification check (added 2026-04-21 after fail2ban self-ban incident):** the verification tests below deliberately produce "Permission denied" responses (2b and 2c). Without a whitelist entry for the operator IP, fail2ban counts these as auth failures and — combined with any Claude-side runs from the same laptop — can cross the 5-failure threshold and ban the laptop. **Before running these tests, confirm the whitelist is in effect:**
```
ssh knuco-droplet 'fail2ban-client get sshd ignoreip'
```
Output must include the operator's current public IP alongside `127.0.0.1/8` and `::1`. If missing (e.g. the operator's laptop public IP changed since 3.5), re-run 3.5's whitelist sub-step with the new IP before proceeding — otherwise you're one test away from a QEMU-console recovery.

**Verify (from fresh laptop terminals):**
```
# 1. knuco key auth still works
ssh -o BatchMode=yes knuco@161.35.0.183 'echo KEY_AUTH_STILL_WORKS'

# 2. root key auth refused
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/knuco_do_ed25519 root@161.35.0.183 'echo SHOULD_NOT_REACH' 2>&1 | grep -q "Permission denied" && echo ROOT_LOGIN_REFUSED

# 3. password auth refused for any user
ssh -o BatchMode=yes -o PreferredAuthentications=password -o IdentitiesOnly=yes knuco@161.35.0.183 'echo SHOULD_NOT_REACH' 2>&1 | grep -q "Permission denied" && echo PASSWORD_AUTH_REFUSED
```

**Rollback (if locked out):** DO web console → `mv /root/sshd-config-backup-pre-phase3/* /etc/ssh/sshd_config.d/ && rm /etc/ssh/sshd_config.d/00-knuco-hardening.conf && systemctl reload ssh`.

**Approval gate:** APPROVED — 3.8 sshd hardening. Second session is open.

### 3.9 Swap `~/.ssh/config` alias from root → knuco

**Action (on laptop):** backup `~/.ssh/config` again, edit `Host knuco-droplet` to use `User knuco`, remove the `# TODO` line.

**Commands:**
```
cp ~/.ssh/config ~/.ssh/config.bak-2026-04-XX-phase3   # XX = day of execution
# Edit ~/.ssh/config: User root → User knuco; remove the TODO comment line
cat ~/.ssh/config   # verify visually
ssh knuco-droplet 'whoami'   # expect: knuco
ssh knuco-droplet 'sudo -n whoami'   # expect: root
```

**Verify:** `whoami` returns `knuco`; `sudo -n whoami` returns `root`.

**Rollback:** `mv ~/.ssh/config.bak-2026-04-XX-phase3 ~/.ssh/config`.

**Approval gate:** APPROVED — 3.9 alias swap.

### 3.10 Mount block-storage volume by UUID

**Action:** ensure `/mnt/volume_nyc1_1776773233539` is in `/etc/fstab` by UUID (not device path) for reboot safety. Verify volume is empty before assigning to Postgres.

**Commands:**
```
ssh knuco-droplet 'mount | grep /mnt/volume; cat /etc/fstab; lsblk -f /dev/sda'

# If fstab uses /dev/sda (not UUID), update:
ssh knuco-droplet 'UUID=$(blkid -s UUID -o value /dev/sda); echo "UUID=$UUID"; sudo cp /etc/fstab /etc/fstab.bak-pre-knuco; sudo sed -i "s|^/dev/sda |UUID=$UUID |" /etc/fstab; cat /etc/fstab'

# Test fstab without rebooting
ssh knuco-droplet 'sudo mount -a && mount | grep /mnt/volume'

# Verify volume is empty (only lost+found acceptable)
ssh knuco-droplet 'ls -la /mnt/volume_nyc1_1776773233539/'
```

If volume contains anything other than `lost+found/`: **abort and ask user.**

**Verify:** reboot droplet (`ssh knuco-droplet sudo reboot`), wait 60s, reconnect, confirm: `ssh knuco-droplet 'df -h /mnt/volume_nyc1_1776773233539 && lsblk -f /dev/sda'`.

**Rollback:** `mv /etc/fstab.bak-pre-knuco /etc/fstab && mount -a`.

**Approval gate:** APPROVED — 3.10 fstab UUID + reboot test + volume-empty confirmed.

### 3.11 Install Node 22 LTS via NodeSource + hold

**Commands:**
```
ssh knuco-droplet 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
ssh knuco-droplet 'sudo apt-get install -y nodejs'
ssh knuco-droplet 'sudo apt-mark hold nodejs'
ssh knuco-droplet 'node --version && npm --version'
```

`apt-mark hold` prevents unattended-upgrades from accidentally jumping to a newer major Node version.

**Verify:** `node --version` shows `v22.x.x`. `apt-mark showhold` lists `nodejs`.

**Rollback:** `apt-mark unhold nodejs && apt-get -y purge nodejs && rm /etc/apt/sources.list.d/nodesource.list`.

**Approval gate:** APPROVED — 3.11 Node 22.

### 3.12 Install PostgreSQL 16 from PGDG repo

Ubuntu 24.04 ships Postgres 16 by default, but using the PGDG repo guarantees we track 16.x point releases independently of Ubuntu's freeze schedule (and matches the local 16.13 we saw in Phase 1).

**Commands:**
```
ssh knuco-droplet 'sudo apt-get install -y postgresql-common'
ssh knuco-droplet 'sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y'
ssh knuco-droplet 'sudo apt-get install -y postgresql-16'
ssh knuco-droplet 'sudo systemctl status postgresql --no-pager'
ssh knuco-droplet 'sudo -u postgres psql -c "SELECT version();"'
```

**Verify:** Postgres 16.x running. `psql -c "SELECT version();"` returns `PostgreSQL 16.x ...`.

**Rollback:** `systemctl stop postgresql && apt-get -y purge "postgresql-16" "postgresql-client-16" "postgresql-common"`.

**Approval gate:** APPROVED — 3.12 PostgreSQL 16.

### 3.13 Move PostgreSQL data dir to volume (Q13)

**⚠ Take a fresh DO snapshot before this step.** Sequential, careful.

**Commands:**
```
# 1. Stop Postgres
ssh knuco-droplet 'sudo systemctl stop postgresql'

# 2. Confirm current data dir
ssh knuco-droplet 'sudo grep ^data_directory /etc/postgresql/16/main/postgresql.conf'
# Expect: data_directory = '/var/lib/postgresql/16/main'

# 3. Re-confirm volume is mounted, empty
ssh knuco-droplet 'df -h /mnt/volume_nyc1_1776773233539 && ls -la /mnt/volume_nyc1_1776773233539/'

# 4. Create target directory
ssh knuco-droplet 'sudo install -d -o postgres -g postgres -m 700 /mnt/volume_nyc1_1776773233539/postgres'

# 5. rsync data dir (preserving permissions, xattrs, sparse files)
ssh knuco-droplet 'sudo rsync -aXS --info=progress2 /var/lib/postgresql/16/main/ /mnt/volume_nyc1_1776773233539/postgres/main/'

# 6. Verify byte-by-byte
ssh knuco-droplet 'sudo diff -rq /var/lib/postgresql/16/main/ /mnt/volume_nyc1_1776773233539/postgres/main/ 2>&1 | head -20'
# Expect: no output (or only files in pg_log differing, which is fine)

# 7. Update data_directory in postgresql.conf
#    Use stdin-fed Python rather than sed with nested-quoting gymnastics.
ssh knuco-droplet 'sudo cp /etc/postgresql/16/main/postgresql.conf /etc/postgresql/16/main/postgresql.conf.bak-pre-volume-move'
cat <<'PYEOF' | ssh knuco-droplet 'sudo python3 -'
import pathlib, re
p = pathlib.Path('/etc/postgresql/16/main/postgresql.conf')
new = re.sub(
    r'^data_directory\s*=.*$',
    "data_directory = '/mnt/volume_nyc1_1776773233539/postgres/main'",
    p.read_text(),
    flags=re.MULTILINE,
)
p.write_text(new)
print('OK')
PYEOF
ssh knuco-droplet 'sudo grep ^data_directory /etc/postgresql/16/main/postgresql.conf'

# 8. Move old data dir aside (do NOT delete; keep for one week as recovery)
ssh knuco-droplet 'sudo mv /var/lib/postgresql/16/main /var/lib/postgresql/16/main.old-pre-volume-move-2026-04-XX'

# 9. Start Postgres
ssh knuco-droplet 'sudo systemctl start postgresql && sudo systemctl status postgresql --no-pager'

# 10. Verify it's reading from the new path
ssh knuco-droplet 'sudo -u postgres psql -c "SHOW data_directory;"'
# Expect: /mnt/volume_nyc1_1776773233539/postgres/main
```

**Verify reboot:** `ssh knuco-droplet sudo reboot`. Wait 60s. `ssh knuco-droplet 'sudo systemctl status postgresql --no-pager && sudo -u postgres psql -c "SHOW data_directory;"'` — Postgres comes up clean on the volume path.

**Rollback:**
```
ssh knuco-droplet 'sudo systemctl stop postgresql'
ssh knuco-droplet 'sudo mv /var/lib/postgresql/16/main.old-pre-volume-move-2026-04-XX /var/lib/postgresql/16/main'
ssh knuco-droplet 'sudo cp /etc/postgresql/16/main/postgresql.conf.bak /etc/postgresql/16/main/postgresql.conf'
ssh knuco-droplet 'sudo systemctl start postgresql'
ssh knuco-droplet 'sudo rm -rf /mnt/volume_nyc1_1776773233539/postgres'
```

**Cleanup (post-Phase-6, after 7 days stable):** delete `/var/lib/postgresql/16/main.old-pre-volume-move-2026-04-XX`.

**Approval gate:** APPROVED — 3.13 data dir move. Snapshot taken.

### 3.14 Create knuco DB + DB user with strong password

**Commands.** The password is generated on the laptop and is never placed in any command-line argument (so it can't leak via shell history, `ps`, or remote bash history). It's fed to `psql` via stdin only.

**History hygiene (run BEFORE generating the password, in the shell that will hold $PGPASS):**
```
# bash:
HISTCONTROL=ignorespace HISTFILE=/dev/null
# zsh equivalent:
# HISTFILE=/dev/null && setopt HIST_IGNORE_SPACE
```
Then prefix every sensitive command in this section with a leading space (which `HISTCONTROL=ignorespace` keeps out of history).

**Commands:**
```
 PGPASS=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)

 # Display once — block until user confirms it's in 1Password
 cat <<BANNER
═══════════════════════════════════════════════════════════════════════
DB PASSWORD — SAVE TO 1PASSWORD NOW. This is the ONLY time it is shown.

  $PGPASS

═══════════════════════════════════════════════════════════════════════
BANNER
 read -p "Press Enter ONLY after the password is saved to 1Password... " _

 # Create user + DB via stdin-fed psql.
 # The SQL is heredoc-expanded locally, then piped over ssh to remote psql's
 # stdin. The password never appears in the remote process's argv (no `-c`
 # flag), so it doesn't show up in remote bash history or remote process listings.
 ssh knuco-droplet 'sudo -u postgres psql' <<SQL
CREATE USER knuco_app WITH PASSWORD '$PGPASS';
CREATE DATABASE knuco OWNER knuco_app;
GRANT ALL PRIVILEGES ON DATABASE knuco TO knuco_app;
SQL

 # Verify the password works. Pipe password through ssh stdin so it never
 # appears in argv on either side. Remote `read -s pw` consumes the password
 # off stdin into a shell variable; `PGPASSWORD="$pw"` exports it just for the
 # psql invocation.
 { echo "$PGPASS"; echo "SELECT current_user, current_database();"; } | \
   ssh knuco-droplet 'read -s pw && PGPASSWORD="$pw" psql -h 127.0.0.1 -U knuco_app -d knuco'
 # Expected: knuco_app | knuco
```

**Reuse:** `$PGPASS` stays in this same shell session for use in 4.4 (env file assembly). Do not echo it again. After 4.4 completes successfully, run `unset PGPASS` and exit the shell.

**Verify:** the stdin-piped psql query in the last block prints `knuco_app | knuco` to confirm the password works.

**Rollback:** `DROP DATABASE knuco; DROP USER knuco_app;` on droplet (run as postgres superuser).

**Approval gate:** APPROVED — 3.14 DB + user. **Required:** user has saved `$PGPASS` to 1Password (mandatory per Q12 / Section 13 checklist; not optional).

### 3.15 Install Nginx (vhost added in 5.2)

**Commands:**
```
ssh knuco-droplet 'sudo apt-get install -y nginx'
ssh knuco-droplet 'sudo systemctl enable --now nginx'
ssh knuco-droplet 'curl -I http://127.0.0.1/'
```

**Verify:** default Nginx welcome page returns 200 from localhost. From laptop: `curl -I http://161.35.0.183/` returns 200 (proves UFW + port 80 path).

**Rollback:** `systemctl disable --now nginx && apt-get -y purge nginx`.

**Approval gate:** APPROVED — 3.15 Nginx install.

### 3.16 Install Certbot (used in 5.4)

**Commands:**
```
ssh knuco-droplet 'sudo apt-get install -y certbot python3-certbot-nginx'
ssh knuco-droplet 'certbot --version'
```

**Verify:** version reports >= 2.x.

**Rollback:** `apt-get -y purge certbot python3-certbot-nginx`.

**Approval gate:** APPROVED — 3.16 Certbot.

### 3.17 Create application directory structure

**Commands:**
```
ssh knuco-droplet 'sudo install -d -o knuco -g knuco -m 755 /opt/knuco'
ssh knuco-droplet 'sudo install -d -o knuco -g knuco -m 750 /etc/knuco'
ssh knuco-droplet 'sudo install -d -o knuco -g knuco -m 750 /var/log/knuco'
ssh knuco-droplet 'sudo install -d -o knuco -g knuco -m 750 /var/backups/knuco'
ssh knuco-droplet 'sudo install -d -o knuco -g knuco -m 755 /var/lib/knuco'
ssh knuco-droplet 'sudo install -d -o knuco -g knuco -m 700 /var/lib/knuco/uploads'
ssh knuco-droplet 'ls -la /opt/knuco /etc/knuco /var/log/knuco /var/backups/knuco /var/lib/knuco/uploads'
```

**Verify:** `ls -la` shows correct ownership and modes for every path.

**Rollback:** `rm -rf /opt/knuco /etc/knuco /var/log/knuco /var/backups/knuco /var/lib/knuco`.

**Approval gate:** APPROVED — 3.17 directories.

### Phase 3 exit criteria

All 17 approval gates passed. Final check:
```
ssh knuco-droplet 'sudo systemctl is-active postgresql nginx ssh fail2ban'   # all active
ssh knuco-droplet 'sudo systemctl is-enabled postgresql nginx ssh fail2ban'  # all enabled
ssh knuco-droplet 'sudo ufw status verbose'                                   # active, 22/80/443 allow
ssh knuco-droplet 'sudo -u postgres psql -c "SHOW data_directory;"'          # on volume
ssh knuco-droplet 'sudo reboot' && sleep 60                                   # reboot
ssh knuco-droplet 'uptime && sudo systemctl is-active postgresql nginx ssh fail2ban'  # post-reboot
```

If all green: Phase 3 complete. Move to Phase 4.

---

## 4. Phase 4 — Transfer code, env, run migrations + seed + admin

### 4.1 Pre-flight on laptop

**Action:** confirm working tree clean, on `main`, HSTS preload removed and committed.

**Commands:**
```
git -C /Users/legalassistant/constructioncrm status                              # expect clean
git -C /Users/legalassistant/constructioncrm rev-parse --abbrev-ref HEAD          # expect main
git -C /Users/legalassistant/constructioncrm grep -n "preload" next.config.ts     # expect no match (or empty)
```

If preload is still in `next.config.ts`: edit to remove `; preload`, then:
```
git -C /Users/legalassistant/constructioncrm add next.config.ts
git -C /Users/legalassistant/constructioncrm commit -m "$(cat <<'EOF'
security: drop HSTS preload until prod stable for 6 months

Re-add and submit to hstspreload.org after sustained stable production.
Tracked in RUNBOOK.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Approval gate:** APPROVED — 4.1 pre-flight.

### 4.2 Author `scripts/create-admin.ts` (Q2 spec)

**File:** `/Users/legalassistant/constructioncrm/scripts/create-admin.ts`.

**Spec:**
- CLI flags: `--email <email>`, `--name "<First Last>"`, `--role <RoleName>` (default `ADMIN`), `--password <pw>` (optional).
- If `--password` not provided: generate via `crypto.randomBytes(24).toString("base64")` (~32 base64 chars).
- Hash via `bcrypt.hash(password, 12)` matching the existing `seed.ts` cost factor.
- Look up role by name; insert User; print `CREATED user <email> | password: <pw>` to stdout exactly once.
- **Idempotency:** if `user.email` already exists, print `USER EXISTS, skipping` and exit 0. **Never overwrite.**
- Uses the same Prisma adapter as seed.ts (`PrismaPg` + `connectionString: process.env.DATABASE_URL!`).

I'll author this file and commit it before the deploy. Implementation is mechanical — I'll show the full code for review before committing.

**Approval gate:** APPROVED — 4.2 create-admin.ts implementation (after code review).

### 4.3 Author `scripts/seed-prod.ts` (Q2 reduced seed)

**File:** `/Users/legalassistant/constructioncrm/scripts/seed-prod.ts`.

**Spec:** subset of `prisma/seed.ts` covering only:
- Roles (6): ADMIN, MANAGER, SALES_REP, OFFICE_STAFF, MARKETING, READ_ONLY.
- Lead stages (11): from existing seed.
- Lead sources (10): from existing seed.
- Service categories (5 parents + their children): from existing seed.
- Job stages (15): from `prisma/seed-jobs.ts`.
- Crews (5): from `prisma/seed-jobs.ts`.

**Skips:** all User creation. **Idempotent:** `prisma.role.upsert(...)` etc.

**Approval gate:** APPROVED — 4.3 seed-prod.ts implementation (after code review).

### 4.4 Assemble `.env.production` locally + scp to droplet

**Action (on laptop):** generate `NEXTAUTH_SECRET` silently into a shell variable (never displayed); assemble env file in laptop `/tmp` with mode 600 from creation; **stream content directly into `/etc/knuco/env` on the droplet via ssh stdin** (no intermediate file in `/tmp` on the droplet); shred local copy.

**Commands (run in the same shell that holds `$PGPASS` from 3.14):**
```
 # Generate NEXTAUTH_SECRET into a shell variable. Do NOT echo it.
 # Nothing outside the droplet ever needs this value, so we keep it out of scrollback.
 NEXTAUTH_SECRET=$(openssl rand -base64 48)

 # Assemble env file. umask 077 ensures the file is mode 600 from the moment of creation
 # (closing the brief window where /tmp/knuco.env.production might exist with default 0644 perms).
 umask 077
 cat > /tmp/knuco.env.production <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://knuco_app:$PGPASS@127.0.0.1:5432/knuco?schema=public
NEXTAUTH_URL=https://crm.knuconstruction.com
NEXTAUTH_SECRET=$NEXTAUTH_SECRET

# Optional — leave commented until features go live:
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_FROM_NUMBER=
# OUTLOOK_TENANT_ID=
# OUTLOOK_CLIENT_ID=
# OUTLOOK_CLIENT_SECRET=
# OUTLOOK_MAILBOX_ADDRESS=
EOF
 umask 022

 # Stream env content directly into /etc/knuco/env on the droplet, created by
 # the knuco user with mode 600 from the first byte. NO intermediate plaintext
 # file is ever written to the droplet's disk (skipping the scp-to-/tmp pattern
 # that would leave a world-readable file open for a brief window).
 ssh knuco-droplet '
   sudo -u knuco bash -c "umask 077; cat > /etc/knuco/env"
 ' < /tmp/knuco.env.production

 # Verify end state
 ssh knuco-droplet 'sudo ls -la /etc/knuco/env'
 # Expected: -rw------- 1 knuco knuco <bytes>
 ssh knuco-droplet 'sudo -u knuco wc -l /etc/knuco/env && sudo -u knuco grep -c ^NODE_ENV /etc/knuco/env && sudo -u knuco grep -c ^DATABASE_URL /etc/knuco/env'
 # Expected: line count > 4; NODE_ENV count = 1; DATABASE_URL count = 1.

 # Shred local laptop copy IMMEDIATELY after successful verify
 shred -u /tmp/knuco.env.production

 # Clean up shell variables (NEXTAUTH_SECRET was never displayed; PGPASS was
 # displayed once and saved to 1Password per 3.14)
 unset NEXTAUTH_SECRET PGPASS
```

**Pre-flight zod validation** happens implicitly when `next build` runs in 4.6 — `env.ts` throws if any required var is invalid.

**Rollback:** `ssh knuco-droplet 'sudo rm /etc/knuco/env'`, regenerate from this section.

**Approval gate:** APPROVED — 4.4 env assembly + transfer.

### 4.5 Rsync code to `/opt/knuco/`

**Exclude list:**
```
--exclude=.git/
--exclude=node_modules/
--exclude=.next/
--exclude=dist/
--exclude=build/
--exclude=.env*
--exclude=.DS_Store
--exclude=*.log
--exclude=src/generated/prisma/
--exclude=DISCOVERY.md
--exclude=MIGRATION_LOG.md
--exclude=MIGRATION_PLAN.md
--exclude=__pycache__/
--exclude=*.tsbuildinfo
--exclude=next-env.d.ts
```

**Dry run first:**
```
rsync -avzn --delete \
  --exclude=.git/ --exclude=node_modules/ --exclude=.next/ --exclude=dist/ \
  --exclude=build/ --exclude=.env* --exclude=.DS_Store --exclude=*.log \
  --exclude=src/generated/prisma/ \
  --exclude=DISCOVERY.md --exclude=MIGRATION_LOG.md --exclude=MIGRATION_PLAN.md \
  --exclude=__pycache__/ --exclude=*.tsbuildinfo --exclude=next-env.d.ts \
  -e ssh \
  /Users/legalassistant/constructioncrm/ knuco-droplet:/opt/knuco/
```

**User reviews dry-run output.** If clean: drop `-n` for real run.

**Verify:** `ssh knuco-droplet 'ls -la /opt/knuco/'` — package.json, prisma/, src/, scripts/ etc. present; no `.env`, no `node_modules`, no `.next`, no markdown migration docs.

**Rollback:** `ssh knuco-droplet 'sudo rm -rf /opt/knuco/*'` then re-rsync.

**Approval gate:** APPROVED — 4.5 rsync (after dry-run review).

### 4.6 Install dependencies + Prisma generate + build

**Commands:**
```
ssh knuco-droplet 'cd /opt/knuco && npm ci'
ssh knuco-droplet 'cd /opt/knuco && npx prisma generate'
ssh knuco-droplet 'cd /opt/knuco && set -a && . /etc/knuco/env && set +a && npm run build'
```

`set -a; . /etc/knuco/env; set +a` exports every variable from the env file so `next build` can validate via `env.ts`.

**Verify:** `ssh knuco-droplet 'ls /opt/knuco/.next/ && ls /opt/knuco/src/generated/prisma/'` — both present. `cd /opt/knuco && npm run typecheck` passes.

**Rollback:** `cd /opt/knuco && rm -rf node_modules .next src/generated/prisma`.

**Approval gate:** APPROVED — 4.6 install + generate + build.

### 4.7 Run `prisma migrate deploy`

**Commands:**
```
ssh knuco-droplet 'cd /opt/knuco && set -a && . /etc/knuco/env && set +a && npx prisma migrate deploy'
```

`migrate deploy` is the production-safe variant — only applies pending migrations, no schema-reset, no interactive prompts.

**Verify:**
```
ssh knuco-droplet 'sudo -u postgres psql -d knuco -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;"'
```
Expect 3 rows (the 3 migrations on disk), all with `finished_at` non-null.

**Rollback:** since this is the first deploy and the DB was empty,  `DROP DATABASE knuco; CREATE DATABASE knuco OWNER knuco_app;` then re-run from 4.7. (Subsequent deploys would restore from the 4.6 backup taken before migrate.)

**Approval gate:** APPROVED — 4.7 migrate deploy.

### 4.8 Run reduced production seed

**Commands:**
```
ssh knuco-droplet 'cd /opt/knuco && set -a && . /etc/knuco/env && set +a && npx tsx scripts/seed-prod.ts'
```

**Verify:**
```
ssh knuco-droplet 'sudo -u postgres psql -d knuco -c "SELECT (SELECT COUNT(*) FROM roles) roles, (SELECT COUNT(*) FROM lead_stages) lead_stages, (SELECT COUNT(*) FROM lead_sources) lead_sources, (SELECT COUNT(*) FROM service_categories) service_categories, (SELECT COUNT(*) FROM job_stages) job_stages, (SELECT COUNT(*) FROM crews) crews, (SELECT COUNT(*) FROM users) users;"'
```
Expect roles=6, lead_stages=11, lead_sources=10, service_categories=21, job_stages=15, crews=5, **users=0**.

**Rollback:** seed is idempotent (upserts). Worst case: `TRUNCATE roles, lead_stages, lead_sources, service_categories, job_stages, crews CASCADE;` and re-run.

**Approval gate:** APPROVED — 4.8 reduced seed.

### 4.9 Create the single ADMIN user (Q2)

**Commands:**
```
ssh knuco-droplet 'cd /opt/knuco && set -a && . /etc/knuco/env && set +a && npx tsx scripts/create-admin.ts \
  --email "richard@rcareylaw.com" \
  --name "Richard Carey" \
  --role "ADMIN"'
```

**Output (one-time visible):** `CREATED user richard@rcareylaw.com | password: <generated 32 chars>`. **User saves to password manager immediately.**

**Verify:**
```
ssh knuco-droplet 'sudo -u postgres psql -d knuco -c "SELECT email, first_name, last_name, role_id, is_active FROM users;"'
```
Expect exactly 1 row with email `richard@rcareylaw.com`.

**Idempotency check:** re-running the same command should print `USER EXISTS, skipping` and exit 0, with no DB change.

**Rollback:** `DELETE FROM users WHERE email = 'richard@rcareylaw.com';` then re-run.

**Approval gate:** APPROVED — 4.9 admin user. User has captured the password.

---

## 5. Phase 5 — Wire it up: systemd, Nginx, TLS, backups

### 5.1 systemd unit `knuco.service`

**Proposed file** `/etc/systemd/system/knuco.service`:
```
[Unit]
Description=KNUCO CRM (Next.js)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=knuco
Group=knuco
WorkingDirectory=/opt/knuco
EnvironmentFile=/etc/knuco/env
Environment=NODE_ENV=production
Environment=PORT=4000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node /opt/knuco/node_modules/.bin/next start -p 4000 -H 127.0.0.1
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

I'll show this exact content for user review before writing. Then:
```
ssh knuco-droplet 'sudo install -m 644 -o root -g root /tmp/knuco.service /etc/systemd/system/knuco.service'
ssh knuco-droplet 'sudo systemctl daemon-reload && sudo systemctl enable --now knuco'
ssh knuco-droplet 'sudo systemctl status knuco --no-pager'
```

**Verify:** `systemctl is-active knuco` returns `active`. `journalctl -u knuco -n 50 --no-pager` shows Next.js boot logs without errors. `curl -I http://127.0.0.1:4000/` returns 200/302.

**Rollback:** `sudo systemctl disable --now knuco && sudo rm /etc/systemd/system/knuco.service && sudo systemctl daemon-reload`.

**Approval gate:** APPROVED — 5.1 systemd unit (after exact-content review).

### 5.2 Nginx vhost (HTTPS off until 5.4)

**Proposed file** `/etc/nginx/sites-available/knuco`:
```
server {
    listen 80;
    listen [::]:80;
    server_name crm.knuconstruction.com;

    # ACME challenge (certbot manages)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Pre-TLS: also serve via HTTP so we can verify before certbot.
    # After 5.4 certbot adds the redirect; remove this block at that time.
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Block dotfiles (.git, .env, etc.)
    location ~ /\. {
        deny all;
        return 404;
    }

    client_max_body_size 25M;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

**Commands:**
```
ssh knuco-droplet 'sudo install -m 644 -o root -g root /tmp/nginx-knuco /etc/nginx/sites-available/knuco'
ssh knuco-droplet 'sudo ln -sf /etc/nginx/sites-available/knuco /etc/nginx/sites-enabled/knuco'
ssh knuco-droplet 'sudo rm -f /etc/nginx/sites-enabled/default'
ssh knuco-droplet 'sudo nginx -t && sudo systemctl reload nginx'
```

**Verify:** from laptop, `curl -I http://crm.knuconstruction.com/` (after DNS in 5.3) returns 200/302 from the app. `curl http://161.35.0.183/.well-known/acme-challenge/test` returns 404 (not 200; root dir is empty for this challenge path).

**Rollback:** `sudo rm /etc/nginx/sites-enabled/knuco && sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx`.

**Approval gate:** APPROVED — 5.2 Nginx vhost (after exact-content review).

### 5.3 DNS (user action)

**Action (user, at GoDaddy):**
- Type: `A`
- Name: `crm`
- Value: `161.35.0.183`
- TTL: 300 (5 min)

**Verify (from laptop):**
```
dig +short crm.knuconstruction.com @1.1.1.1
dig +short crm.knuconstruction.com @8.8.8.8
dig +short crm.knuconstruction.com @9.9.9.9
```
All three resolvers must return `161.35.0.183` before running 5.4. New A records typically propagate in <5 min for these public resolvers.

**Approval gate:** USER posts `DNS PROPAGATED — crm.knuconstruction.com → 161.35.0.183` after dig confirms.

### 5.4 Certbot — TLS via Let's Encrypt

**Dry-run first:**
```
ssh knuco-droplet 'sudo certbot --nginx --dry-run -d crm.knuconstruction.com --non-interactive --agree-tos -m richard@rcareylaw.com --redirect'
```

If the dry-run succeeds, real run:
```
ssh knuco-droplet 'sudo certbot --nginx -d crm.knuconstruction.com --non-interactive --agree-tos -m richard@rcareylaw.com --redirect'
```

`--redirect` makes certbot edit the Nginx vhost to force HTTP → HTTPS.

**Verify (from laptop):**
```
curl -I https://crm.knuconstruction.com/                      # expect 200
curl -I http://crm.knuconstruction.com/                       # expect 301 to https
openssl s_client -connect crm.knuconstruction.com:443 \
  -servername crm.knuconstruction.com < /dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer
ssh knuco-droplet 'sudo systemctl list-timers | grep certbot'   # auto-renewal timer present
```

**Rollback:** `sudo certbot delete --cert-name crm.knuconstruction.com` and revert the vhost from the 5.2 backup if needed.

**Approval gate:** APPROVED — 5.4 certbot dry-run, then real run.

### 5.5 logrotate audit

App logs to journald (managed automatically). Nginx logs use Ubuntu's stock `/etc/logrotate.d/nginx` (daily, 14 keep, compress). Verify:
```
ssh knuco-droplet 'cat /etc/logrotate.d/nginx'
ssh knuco-droplet 'sudo logrotate -d /etc/logrotate.d/nginx 2>&1 | head -30'   # dry-run
```

If acceptable, no action. Otherwise customize.

**Approval gate:** APPROVED — 5.5 logrotate audit.

### 5.6 Nightly DB backup + 14-day retention

**File** `/usr/local/bin/knuco-backup.sh`:
```
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/var/backups/knuco
RETENTION_DAYS=14
TS=$(date +%Y-%m-%d-%H%M%S)
DUMP_FILE="$BACKUP_DIR/postgres-$TS.dump"

# Source env (DB password) from canonical env file (single source of truth).
set -a; . /etc/knuco/env; set +a

# Extract password from DATABASE_URL.
# NOTE: this regex is tied to the Prisma-style URL format
#   postgresql://<user>:<password>@<host>:<port>/<db>?<query>
# If the URL format ever changes (e.g. percent-encoded chars in the password,
# alternate scheme like postgres://, additional userinfo components, IPv6 host
# in brackets), this regex MUST be updated. If the URL format becomes
# meaningfully more complex, migrate to ~postgres/.pgpass (mode 0600) or
# PGPASSFILE= and stop parsing the URL.
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')

# Fail loudly if password extraction failed (regex stale, env unset, etc.).
if [ -z "${DB_PASS:-}" ]; then
  echo "ERROR: failed to extract DB password from DATABASE_URL." >&2
  echo "  DATABASE_URL shape (password redacted): $(echo "${DATABASE_URL:-<unset>}" | sed 's|:[^@]*@|:<REDACTED>@|')" >&2
  exit 1
fi

PGPASSWORD="$DB_PASS" pg_dump -Fc -h 127.0.0.1 -U knuco_app -d knuco -f "$DUMP_FILE"

# Verify dump non-empty
[ -s "$DUMP_FILE" ] || { echo "ERROR: dump file is empty" >&2; exit 1; }

# Retention
find "$BACKUP_DIR" -name "postgres-*.dump" -mtime +$RETENTION_DAYS -delete

# Report
echo "OK: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
ls -lh "$BACKUP_DIR" | tail -5
```

**File** `/etc/systemd/system/knuco-backup.service`:
```
[Unit]
Description=KNUCO DB backup
After=postgresql.service
Requires=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/knuco-backup.sh
User=root
StandardOutput=journal
StandardError=journal
```

**File** `/etc/systemd/system/knuco-backup.timer`:
```
[Unit]
Description=Nightly KNUCO DB backup

[Timer]
OnCalendar=*-*-* 02:30:00 America/New_York
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

**Install:**
```
ssh knuco-droplet 'sudo install -m 750 -o root -g knuco /tmp/knuco-backup.sh /usr/local/bin/knuco-backup.sh'
ssh knuco-droplet 'sudo install -m 644 -o root -g root /tmp/knuco-backup.service /etc/systemd/system/knuco-backup.service'
ssh knuco-droplet 'sudo install -m 644 -o root -g root /tmp/knuco-backup.timer /etc/systemd/system/knuco-backup.timer'
ssh knuco-droplet 'sudo systemctl daemon-reload && sudo systemctl enable --now knuco-backup.timer'
ssh knuco-droplet 'sudo systemctl list-timers knuco-backup.timer'
```

**Verify (manual one-shot):**
```
ssh knuco-droplet 'sudo systemctl start knuco-backup.service && sudo journalctl -u knuco-backup -n 20 --no-pager && sudo ls -lh /var/backups/knuco/'
```

**Rollback:** disable + remove all three files.

**Approval gate:** APPROVED — 5.6 backup automation.

---

## 6. Phase 6 — Verification (eyes-on)

1. `ssh knuco-droplet 'sudo systemctl is-active knuco postgresql nginx ssh fail2ban knuco-backup.timer'` — all `active`.
2. `ssh knuco-droplet 'sudo systemctl is-enabled knuco postgresql nginx ssh fail2ban knuco-backup.timer'` — all `enabled`.
3. From laptop: `curl -I https://crm.knuconstruction.com/` — 200 with valid TLS.
4. `ssh knuco-droplet 'sudo journalctl -u knuco -n 200 --no-pager | grep -iE "error|fatal|exception" | grep -v "source-maps"'` — no real errors.
5. **Browser test (user, eyes-on):**
   - Visit `https://crm.knuconstruction.com/`.
   - Log in as `richard@rcareylaw.com` with the password from 4.9.
   - Create a test lead (any name + phone).
   - Move it through one stage transition.
   - Add an activity log entry.
   - Log out, log back in, confirm test lead persists.
   - Visit `/admin` — should be accessible (ADMIN role).
6. **Reboot test:** `ssh knuco-droplet sudo reboot`. Wait 60s. Reconnect. Re-verify steps 1–4 + a fresh login + the test lead still exists.
7. **Backup smoke test:**
   ```
   ssh knuco-droplet 'sudo systemctl start knuco-backup.service'
   ssh knuco-droplet 'sudo ls -lh /var/backups/knuco/'
   # Restore the latest dump into a temp DB to verify restore-ability
   ssh knuco-droplet 'sudo -u postgres createdb knuco_restore_test'
   ssh knuco-droplet 'sudo -u postgres pg_restore -d knuco_restore_test /var/backups/knuco/postgres-<latest>.dump'
   ssh knuco-droplet 'sudo -u postgres psql -d knuco_restore_test -c "SELECT COUNT(*) FROM users;"'   # expect 1
   ssh knuco-droplet 'sudo -u postgres dropdb knuco_restore_test'
   ```

**Approval gate:** USER posts `PHASE 6 VERIFIED` after all 7 checks pass. Phase 7 blocked until then.

---

## 7. Phase 7 — Dev-to-prod workflow (`deploy.sh`)

### 7.1 `deploy.sh` requirements (Q8)

Located at `/Users/legalassistant/constructioncrm/deploy.sh`. Permissions `0755`. Logs to `~/knuco-deploys/<timestamp>.log` on the laptop.

**Flags:**
- `--dry-run` — rsync `-n`, show diffs only, no remote DB or service actions.
- `--yes` — skip interactive confirmation prompts (for trusted re-deploys).

**Pre-flight aborts (each fatal):**
1. `git status --porcelain` non-empty → `Working tree dirty`.
2. `git rev-parse --abbrev-ref HEAD` != `main` → `Not on main`.
3. `git log @{u}..` non-empty → `Local has unpushed commits — push origin/main first` (so deployed code is reproducible from the remote).
4. `ssh -o BatchMode=yes -o ConnectTimeout=5 knuco-droplet 'echo OK'` fails → `Cannot reach droplet`.

**Steps:**
1. rsync code to `/opt/knuco/` (same exclude list as 4.5).
2. `npm ci` if `package-lock.json` SHA changed since last deploy (track in `/opt/knuco/.deploy-lockfile-sha`).
3. `npx prisma generate`.
4. **Confirmation prompt** (unless `--yes`): `About to run prisma migrate deploy + restart service. Continue? [y/N]`.
5. `npx prisma migrate deploy`.
6. `npm run build`.
7. `sudo systemctl restart knuco`.
8. `curl -fsS -o /dev/null -w "%{http_code}\n" https://crm.knuconstruction.com/` — expect 200/302/401 (anything in 2xx/3xx/401, since `/` redirects to `/login`). Anything else → fail.
9. Log success + commit SHA + timestamp to `~/knuco-deploys/<ts>.log`.

### 7.2 `DEPLOY.md`

Single-page guide:
- Common case: `./deploy.sh` (interactive).
- Trusted re-deploy after small change: `./deploy.sh --yes`.
- Preview only: `./deploy.sh --dry-run`.

### 7.3 First deploy test

Trivial change (footer string update or version bump in `package.json`), commit + push to `origin/main`, run `./deploy.sh`, verify the change is live in the browser.

**Approval gate:** APPROVED — 7.1/7.2/7.3 implementation + first test.

---

## 8. Phase 8 — Handover (`RUNBOOK.md`)

Created at `/Users/legalassistant/constructioncrm/RUNBOOK.md`. Sections:

- **SSH access:** `ssh knuco-droplet` (alias uses `User knuco` + key auth; `NOPASSWD:ALL` sudo for root escalation).
- **Backup access — the real escape hatch:** the **QEMU virtual serial console** at `https://cloud.digitalocean.com/droplets/<droplet_id>/console?no_layout=true`. Talks directly to the hypervisor, independent of sshd / UFW / fail2ban. Login prompt requires the droplet's `root` password (NOT key auth). The "Launch Droplet Console" button in the DO UI Access tab is **not** a safe backup — it authenticates via the droplet's sshd and is useless because password auth is disabled. Always use the QEMU URL. This distinction was learned during the 2026-04-21 migration — see MIGRATION_LOG.md § 3.8 incident.
- **View logs:** `ssh knuco-droplet 'sudo journalctl -u knuco -f'` (live), `... -n 200 --no-pager` (recent).
- **Restart app:** `ssh knuco-droplet 'sudo systemctl restart knuco'`.
- **Restart DB:** `ssh knuco-droplet 'sudo systemctl restart postgresql'`.
- **Nginx reload:** `ssh knuco-droplet 'sudo nginx -t && sudo systemctl reload nginx'`.
- **Where secrets live:** `/etc/knuco/env` on droplet, mode 600 owned by knuco. Never committed to repo. Laptop assembles fresh per `src/lib/env.ts`.
- **Rotating secrets:**
  - `NEXTAUTH_SECRET`: edit `/etc/knuco/env`, restart knuco. **All existing user JWT sessions invalidated** (signing key changed); users re-login.
  - DB password: `ALTER USER knuco_app WITH PASSWORD '<new>';` then update env, restart.
  - Admin user password: re-run `scripts/create-admin.ts` after `DELETE FROM users WHERE email='...'` (or write a `scripts/rotate-admin-password.ts` later).
  - Twilio / Outlook keys: edit env, restart.
- **Backups location:** `/var/backups/knuco/postgres-YYYY-MM-DD-HHMMSS.dump`. 14-day retention. Tagged systemd timer `knuco-backup.timer`.
- **Restore procedure:** stop knuco → drop+recreate DB → pg_restore → start knuco. Full commands in RUNBOOK.
- **TLS renewal:** automatic via certbot's systemd timer. Verify: `systemctl list-timers | grep certbot`. Manual force: `sudo certbot renew --force-renewal`.
- **Volume detach/reattach (rebuilt droplet scenario):** stop Postgres → unmount → DO panel detach → reattach to new droplet → fix `/etc/fstab` UUID → mount → start Postgres.
- **Updating the fail2ban operator-IP whitelist (when your laptop public IP changes):**
  1. Find the new public IP from the laptop: `curl -s https://api.ipify.org`.
  2. **If SSH to the droplet still works** (not yet banned): `ssh knuco@knuco-droplet`, then
     ```
     sudo sed -i "s/ignoreip =.*/ignoreip = 127.0.0.1\/8 ::1 <NEW_IP>/" /etc/fail2ban/jail.d/knuco-whitelist.local
     sudo systemctl restart fail2ban
     sudo fail2ban-client get sshd ignoreip   # confirm new IP present
     ```
  3. **If SSH is down** (laptop already banned by fail2ban from the old IP): connect via the QEMU serial console (see Backup access above), log in as `root`, first `fail2ban-client set sshd unbanip <OLD_IP>` to clear the ban, then run the same `sed` + `systemctl restart fail2ban` commands from step 2.
  4. Verify: `sudo fail2ban-client get sshd ignoreip` returns the new IP alongside `127.0.0.1/8` and `::1`, and `ssh knuco@knuco-droplet 'echo WORKS'` returns `WORKS` with no delay.
- **Admin user creation invocation** (Q2):
  ```
  cd /opt/knuco && set -a && . /etc/knuco/env && set +a && \
    npx tsx scripts/create-admin.ts --email "<email>" --name "<First Last>" --role "ADMIN"
  ```
- **HSTS preload re-add (post-6mo stable):** edit `next.config.ts` to re-add `; preload`, deploy, then submit at https://hstspreload.org. **Near-irreversible** — be confident before submitting.
- **Tailscale post-Phase-8 hardening (optional, recommended):** see section 9.1.
- **Known caveats:**
  - Outlook intake is manual-only (Q3); use admin UI for `/api/intake/process`. Add automation in a future sprint.
  - File uploads not wired (Q4); `/var/lib/knuco/uploads/` exists but no code path uses it.
  - Twilio + Outlook env vars unset; SMS + email-intake features will throw at runtime if invoked. Set values in `/etc/knuco/env` and restart to enable.
  - SMTP via port 25 is blocked by DigitalOcean. Any future email-send feature must use a relay (SendGrid / Postmark / Mailgun / SES) over 587 or 465.
  - DB and app share the droplet. A memory spike in one starves the other. Migrate to DO Managed DB via `pg_dump | pg_restore` if/when needed.
  - Local `construction_crm` on the laptop is legacy and unrelated to production.

**Approval gate:** APPROVED — 8 RUNBOOK content (after review).

---

## 9. Post-Phase-8 hardening (recommended, not auto-executed)

### 9.1 Add droplet to Tailscale (close public port 22)

```
# On droplet:
ssh knuco-droplet 'curl -fsSL https://tailscale.com/install.sh | sudo sh'
ssh knuco-droplet 'sudo tailscale up --ssh'
# (Tailscale prints an auth URL — visit in browser to add the device to your tailnet.)

# On laptop:
brew install tailscale
sudo tailscale up

# Verify
tailscale status   # should list droplet
ssh knuco-droplet-tailnet 'echo OK'   # via tailnet IP

# Update ~/.ssh/config knuco-droplet block: HostName <tailnet-IP>
ssh knuco-droplet 'echo OK'   # via alias, now over tailnet

# Once verified working over tailnet:
ssh knuco-droplet 'sudo ufw delete allow 22/tcp'
ssh knuco-droplet 'sudo ufw status verbose'   # 22/tcp no longer listed
```

### 9.2 Enable FileVault on laptop

System Settings → Privacy & Security → FileVault → Turn On. No effect on SSH config or Phase 1–8.

### 9.3 Re-add HSTS `preload` (after 6 months stable)

Edit `next.config.ts`, deploy, submit at https://hstspreload.org. **Near-irreversible** once submitted.

### 9.4 Outlook intake automation (Q3 deferred)

Code change: add `INTAKE_CRON_TOKEN` env var + token-based bypass in `/api/intake/process` (auth allowlist for `Authorization: Bearer <token>` header). systemd timer on droplet calls endpoint every 60s. First real production exercise of the deploy workflow.

### 9.5 DO Managed Database migration (if outgrown)

`pg_dump -Fc` on droplet → `pg_restore` to Managed DB → swap `DATABASE_URL` in `/etc/knuco/env` → restart knuco. No code change required (Prisma is provider-agnostic for Postgres).

---

## 10. Pitfall mitigations (mapped to original prompt's list)

| # | Pitfall | Mitigation |
| --- | --- | --- |
| 1 | `.env` not transferred → app crashes on boot | 4.4 explicit env transfer; systemd `EnvironmentFile=`; `env.ts` throws clearly on missing/invalid vars |
| 2 | `node_modules`/`vendor` arch mismatch from local | 4.5 rsync excludes `node_modules`, `src/generated/prisma`; 4.6 reinstalls with `npm ci` |
| 3 | File ownership wrong → app can't write | 3.17 explicit chown + chmod; 4.5 rsync owner via `User=knuco` over SSH; verified in 4.6 |
| 4 | Port already in use on droplet | Phase 1 3b confirmed only 22 + 53 listening. 80/443/4000/5432 free. |
| 5 | UFW blocks the app after enabling | 3.4 allows 22/80/443 BEFORE enable; second SSH session escape hatch; established connections preserved |
| 6 | Locking out via SSH config change | 3.8 keeps second session open; sshd -t pre-validates; verifies key auth from fresh terminal before declaring done |
| 7 | Certbot fails because DNS not propagated | 5.3 user posts `DNS PROPAGATED` only after `dig` returns expected; 5.4 `--dry-run` first |
| 8 | Certbot fails because port 80 unreachable | 5.4 dry-run catches; 3.4 UFW allows 80; 5.2 Nginx serves `/.well-known/acme-challenge/` |
| 9 | DB migration run twice or against wrong DB | `prisma migrate deploy` is idempotent; env's `DATABASE_URL` pinned to knuco DB on 127.0.0.1; first run is on empty DB |
| 10 | Hardcoded localhost in code | Phase 1 3a grep returned no localhost / 127.0.0.1 / 0.0.0.0 in `src/`; tracked-link BASE_URL uses `env.NEXTAUTH_URL` |
| 11 | Timezone mismatch | Droplet stays UTC (server best practice); Prisma stores in UTC; users see local zone in browser |
| 12 | Small droplet OOMs during build | 3.3 adds 2 GB swap before any `npm ci` / `next build`; `vm.swappiness=10` |
| 13 | Default SSH 22 + root password → brute-force | 3.4 UFW; 3.5 fail2ban; 3.6 knuco user with key only; 3.8 PermitRootLogin no + PasswordAuthentication no after key auth verified |
| 14 | App not enabled, doesn't survive reboot | 5.1 `systemctl enable --now`; Phase 6 reboot test re-verifies all services |
| 15 | Log files unbounded | App logs to journald (auto-rotated); Nginx uses Ubuntu's stock logrotate (5.5 audit) |
| 16 | CORS / cookie / trusted-proxy still localhost | 5.2 Nginx sets `X-Forwarded-*`; NextAuth uses `NEXTAUTH_URL=https://crm.knuconstruction.com`; cookies scope to that host |
| 17 | SMTP port 25 blocked by DigitalOcean | Documented in RUNBOOK known-caveats; no email-send path in current code; future feature must use SendGrid/Postmark/Mailgun/SES via 587/465 |
| 18 | `.git/` exposed via Nginx | 5.2 Nginx `location ~ /\.` deny block; rsync excludes `.git/` from `/opt/knuco` |
| 19 | CRLF in shell scripts (Windows source) | macOS dev → no CRLF risk; deploy.sh uses LF only; `core.autocrlf` confirmed unset in Phase 1 |

---

## 11. Rollback plan summary

- **Per-step rollback:** documented inline in each Phase 3–5 step.
- **DO snapshots:** mandatory before 3.1, 3.13. Recommended before 4.5, 5.4.
- **Pre-Phase backups:** none needed for Phase 4 since DB starts empty (Phase 4 itself is the first writes).
- **Catastrophic recovery:** restore from latest DO snapshot via DO panel; Phase 1 3b state is a fallback known-good point.
- **Volume rollback:** `mv /var/lib/postgresql/16/main.old-pre-volume-move-* /var/lib/postgresql/16/main` and revert `postgresql.conf` (per 3.13).
- **DNS rollback:** delete the A record at GoDaddy (TTL 300 means propagation back is fast).

---

## 12. Architecture decisions to revisit (post-Phase-8)

Captured in RUNBOOK § known-caveats. Quick list:
- DB on droplet vs DO Managed Database
- File-uploads backend (when feature ships)
- SMTP relay (when email-send feature exists)
- Outlook intake automation
- Tailscale + close public port 22
- HSTS preload re-add
- Sudo NOPASSWD scope (revisit when team grows beyond single operator)

---

## 13. Go / no-go checklist (must pass before Phase 3 begins)

User must confirm each item explicitly (single message with checkmarks, or `GO/NO-GO: GO`):

- [ ] Read MIGRATION_PLAN.md end to end. No objections to architecture.
- [ ] Manual DigitalOcean snapshot taken via DO panel within last hour. Snapshot name captured.
- [ ] Second SSH session ready as escape hatch (`ssh knuco-droplet` open in a separate terminal window before any sshd / UFW edits).
- [ ] DigitalOcean web console URL bookmarked as last-resort recovery channel.
- [ ] No production-critical workload depends on this droplet right now (we will reboot multiple times during Phase 3).
- [ ] User has saved the to-be-generated DB password (3.14) to their password manager (1Password). **Mandatory — not optional.** The DB password prints exactly once during 3.14; if not captured, recovery requires either reading `/etc/knuco/env` on the droplet or rotating the password (`ALTER USER knuco_app WITH PASSWORD ...` + update env file + restart).
- [ ] User has saved the to-be-generated admin login password (4.9) to their password manager. **Mandatory — not optional.** The admin password prints exactly once during 4.9; if not captured, recovery requires deleting the user row and re-running `scripts/create-admin.ts`.
- [ ] knuco sudo policy: Option A (NOPASSWD:ALL) confirmed by user (decision recorded in 3.7).
- [ ] User accepts `openssl rand -base64 48` as the `NEXTAUTH_SECRET` generation method (value goes directly into `/etc/knuco/env`, never displayed in terminal).
- [ ] User aware that Twilio + Outlook env vars will be empty at first; SMS + intake features will throw at runtime if invoked until those are populated.
- [ ] User accepts that local `construction_crm` DB is **not** touched at any point.

When all checked: post `APPROVED — proceed to Phase 3`. Phase 3 then begins with step 3.1, paused for individual approval per step.

---

## End of plan

Awaiting user review. No execution until `APPROVED — proceed to Phase 3` and the go/no-go checklist (section 13) is fully ticked.
