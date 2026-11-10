# B — Existing CRM and mobile architecture audit (crew view)

Read-only audit, 2026-11-09. **V** = verified in code or by a prod query; **A** = an assumption.

## Prod facts (read-only aggregate queries, no names)

| Fact | Value | Source |
|---|---|---|
| Active CRM users | 7: ADMIN 5, MANAGER 1, CREW_LEAD 1 | `users` ⨝ `roles` (V) |
| Worker records (`personnel`, not deleted) | 4 active W2, 5 active 1099, 1 inactive 1099 | (V) |
| Workers linked to a login (`personnel.user_id`) | 1 | (V) |
| Workers placed in a crew (`personnel.crew_id`) | 0 | (V) |
| Workers with a phone | 4 of 10 | (V) |
| Crews | 11, of which 6 active; 2 with a phone; 0 with a foreman name; 0 set to Spanish; 0 linked to a vendor | (V) |
| Active crews' trades | interior renovations 4, windows 3, doors 2, drywall 2, painting, electrical, general, HVAC, framing, flooring 1 each. No roofing or plumbing crew. | (V) |
| Crew labor contracts on open jobs | 24, of which 16 name no crew (a typed label) | (V) |
| Crew assignments | 3 (2 crews, 3 jobs), 0 confirmed | (V) |
| Field assignments (crew lead ↔ job) | 3 (2 people, 3 jobs) | (V) |
| Field activity, last 60 days | 1 daily log, 0 crew-hour entries, 0 field photos, 0 field issues, 16 payment requests (office-made) | (V) |
| Guest links ever sent | 0 | (V) |
| Phones registered | 1 (the owner's) | (V) |
| Use, last 14 days | phone 96 events by 1 person; web 38 events by 4 people | `usage_events` (V) |
| Open jobs | 21 FIXED_PRICE, 1 OWNED_REHAB | (V) |

**Reading:** KNU's own W2 workforce is four people, and none of them has a login today. The field record is close to empty: the existing field tools are not used, so adoption matters more than more features.

## Feature inventory

Status: **B** built · **P** partial · **M** missing. Reuse: **R** reuse · **Ad** adapt · **N** new.

| # | Feature | St | Key files / routes / tables | Limitation | Reuse |
|---|---|---|---|---|---|
| 1 | Architecture | B | Next 16 `src/app` with route groups (dashboard), (field), (public); Expo app `mobile/` (expo-router, react-query, SQLite); shared contracts `src/lib/mobile-api` | — | R |
| 2 | Authentication | B | CareyOS SSO cookie (`lib/auth/helpers.ts`, `lib/sso.ts`); phone PKCE → 7-day bearer token, revocable (`MobileDeviceToken`, `/api/mobile/*`) | Every login is a CareyOS account; no PIN or SMS-code login | R (W2 get CareyOS accounts) |
| 3 | Roles | B | `RoleName` (schema:28). CREW_LEAD is confined to `/field` by `(dashboard)/layout.tsx:21` | No crew-member role. A new role must also go into the portal `~/careyos/config/apps.config.ts` (CREW_LEAD is listed at :502–511) | N (`CREW_MEMBER`) |
| 4 | Employee records | B | `Personnel` (schema:3238): `userId @unique`, `crewId`, trade, W2/1099, encrypted SSN; `/api/personnel*` | Nobody is linked or placed in a crew on prod | R |
| 5 | Crew records | B | `Crew` (schema:1627): members through `Personnel.crewId`, `foremanName`, `language`, `trades[]`; `/api/crews*` | Foreman is a name, not a user | Ad |
| 6 | Project assignment | B, overlapping | `CrewAssignment` (job ↔ crew, `installDate`, `confirmation`), `JobFieldAssignment` (job ↔ user), PM / sales rep on the job, workflow team slots, `LaborContract.crewId`, `JobPersonnelScope` | **Two access rules disagree** (see C) | Ad (one rule) |
| 7 | Tasks | B | `Task` (checklist, `scheduledStart`), `/api/tasks*`, `lib/tasks/access.ts`; phone tasks, task, new-task, voice-task; web `/field/tasks*` | — | R |
| 8 | Calendar | B | `/api/calendar`, install-date overlay (`lib/calendar/overlays-load.ts:73`), `lib/calendar/field-day.ts`; phone Today (day / week) | No per-crew schedule; `contactOf` shows the customer's phone and address | Ad |
| 9 | Documents | P | `File` + `FileCategory`; plan sets, documents and sheets; `/api/files` (`guardJob` + `fileReadWhere`); phone files/[jobId] | **No category filter on reading**: a crew lead reads estimates, labor contracts and customer contracts (`lib/files/access.ts`; only `CUSTOMER_CONTRACT` is protected, and only from deletion). Plan-sheet routes are lead-scoped for takeoff | N (allowlist) |
| 10 | Photos | B | Phone `photos/prepare.ts` (2000 px, JPEG 0.8, capture time read from EXIF), outbox `file.upload` → `/api/files`; web field → `FieldPhoto` (with GPS) | Two photo stores (`File` vs `FieldPhoto`); GPS stripping on the phone not verified (A) | R |
| 11 | Communications | P | `Communication` is lead-scoped; `ActivityLog`; task notes (`TaskEvent`); phone `task.note` / `lead.note` | No job thread | N (Phase 2) |
| 12 | SMS | P | `twilio-provider.ts` (not configured on prod); inbound `/api/messaging` is lead-only; guest links are sent by hand from the share sheet | — | Ad (later) |
| 13 | Notifications | B | `notify()`, digests, push (`lib/mobile/push.ts`, `my-day.ts`); push text has no money, customer names or phones | — | R |
| 14 | Time tracking | B (crew-lead entry) | `DailyLaborEntry` (minutes, `checkInAt` / `checkOutAt` with lat/lng); check-in / out routes under `daily-logs/[date]/labor/[entryId]` (`requireJobFieldAccess` write); phone crew sheet with Start / Stop now | Workers never clock in themselves | Ad (self clock-in) |
| 15 | Daily logs | B | `DailyLog` DRAFT → SUBMITTED → APPROVED with safety checks and signature; full route set; phone log/[jobId]; web /field daily | — | R (foreman) |
| 16 | Inspections | B | `JobPermitInspection`; reads use `jobAccessWhere`; writes use `guardProductionWrite` (no crew) | — | R (read-only for crew) |
| 17 | Material requests | B | `FieldIssue` MATERIAL_REQUEST → the job's PURCHASING slot + a linked task (`field-issues` route:105); phone materials.tsx | No catalog or history picker | R |
| 18 | Field permission controls | B with gaps | `lib/labor/permissions.ts` (`jobFieldAccess`, `canSeeLaborCosts`, `canViewPayroll`…), `jobMoneyView`, `fileReadWhere`; the phone cache never stores money (`mobile/src/cache/rules.ts`) | Gaps listed in C | Ad |
| 19 | Field screens | B | Web `/field`, `/field/day`, `/field/tasks*`, `/field/jobs/[id]/logs`, `/daily/[date]`; phone has 30 screens (list in the Explore report) | Built for office and foreman, not crew | Ad |
| 20 | Offline | B | Phone SQLite outbox (idempotency keys, back-off), dehydrated query cache wiped at sign-out, drafts, separate document store | Cache not encrypted (SQLCipher skipped to keep the export exemption) | R |

**Also verified:**
- **Guest links:** `lib/guest/*`, `/g/[token]`, purposes CREW_PHOTOS, CREW_PAYMENT and INSTALL_CONFIRM, English and Spanish. A guest sees only the street, the crew, the contract's scope line and the install day. Every submission waits for the office.
- **Spanish:** none outside guest links.
- **Assignment acknowledgement:** exists only through an INSTALL_CONFIRM guest submission.
- **Trade checklists:** the workflow v2 templates (core, roofing, doors & windows, interior incl. plumbing toggles) carry checklists written as PM / office milestones, not trade QA.
