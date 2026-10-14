# CareyOS Construction CRM — GC Partnerships, Build Specifications (Stages 1–4)

_Companion to `CAREYOS_GC_PARTNERSHIPS_IMPLEMENTATION_PLAN.md` (2026-10-13).
This is the build-ready specification: schema, migration SQL, seeds, pure
functions with their test cases, services, API contracts, UI behaviour, QA and
operator steps for each stage. Nothing here is implemented. Where the plan left
a ruling open, the specification follows the recommendation and marks it
**[ruling]** so the alternative can be swapped in before the stage starts._

---

## 0. Conventions every stage follows

- **Branch** `partners-s<n>` from `main` (never from `takeoff-m3`); one
  migration per stage named `2026102x120000_partners_<stage>`; applied with
  `prisma migrate diff` → `db execute` → `migrate resolve --applied`; hand-written
  SQL (sequences, CHECKs, partial indexes) appended to the generated file.
- **Module layout** mirrors `src/lib/vendors/*`: pure files (client-safe, no
  Prisma) beside `*-load.ts` / `service.ts`; `PartnerError(status, message)`
  thrown by services and turned into a response by `partnerErrorResponse`;
  every route = `getSession` → predicate from `access.ts` → `validateBody` →
  service → `recordAudit`.
- **Access**: explicit role lists; never `hasMinRole`. Lists return
  `{ rows, canManage }` so the client hides what the server would refuse.
- **Dates**: all-day facts (follow-up days, document expiry) are `DayKey`
  strings in `APP_TIME_ZONE` pinned to noon UTC when stored (`parseDocDay`
  precedent in `src/lib/vendors/documents.ts`); timed facts (bid due at) are
  instants.
- **Numbers**: money `Decimal(12,2)`; scores `Int`; hours `Decimal(6,1)`.
- **Gate** before every merge: `npm run typecheck`, `npm run lint` (≤ baseline
  6/22), `npm run test`, `npm run build` in a shell that has not sourced `.env`.
- **QA** before every deploy: an API script in the session scratchpad
  (counts reported as `n/n`), headless Chromium at 1280 and 400 px, dev DB
  restored afterwards. Deploy with `KNUCO_PUBLIC_URL=https://crm.careyos.com
  ./deploy.sh --yes`; verify BUILD_ID, migration count, smoke 307 ×2, journal
  clean, backup name.
- **Docs**: `docs/project-memory/features/partners.md` grows per stage;
  CLAUDE.md §3 / §4 / §10 entries as for every other module.

---

## Stage 1 — Organizations, contacts, interactions, follow-ups, the fence

### 1.1 Schema (`prisma/schema.prisma`)

```prisma
enum LeadKind { CUSTOMER GC_BID }
enum OrganizationKind { GENERAL_CONTRACTOR DEVELOPER PROPERTY_MANAGER ARCHITECT ENGINEER MUNICIPALITY REFERRAL_PARTNER OTHER }
enum OrganizationPriority { A B C }
enum PartnerStage { TARGET CONTACTED ENGAGED ACTIVE DORMANT DO_NOT_PURSUE }
enum ContactRole { ESTIMATOR SENIOR_ESTIMATOR PRECON_MANAGER PRECON_DIRECTOR PROCUREMENT TRADE_PARTNER_MANAGER
  BUSINESS_DEVELOPMENT PROJECT_EXECUTIVE PROJECT_MANAGER SUPERINTENDENT ACCOUNTS_PAYABLE SAFETY OTHER }
enum InteractionKind { CALL EMAIL MEETING SITE_VISIT LUNCH LINKEDIN INTRO PREQUAL_SUBMISSION BID_DISCUSSION DOC_SENT NOTE OTHER }
enum InteractionDirection { OUTBOUND INBOUND }
enum InteractionOutcome { NO_ANSWER LEFT_MESSAGE SENT SPOKE REPLIED MEETING_HELD NOT_APPLICABLE }

model Organization {
  id                     String               @id @default(cuid())
  name                   String
  nameKey                String               @unique @map("name_key")      // normalised: lowercased, punctuation stripped, whitespace collapsed
  kind                   OrganizationKind     @default(GENERAL_CONTRACTOR)
  website                String?
  phone                  String?
  email                  String?
  address1               String?              @map("address_1")
  address2               String?              @map("address_2")
  city                   String?
  state                  String?              @default("FL")
  zipCode                String?              @map("zip_code")
  localOffices           String?              @map("local_offices") @db.Text
  markets                String[]             @default([])                 // county names from PartnerSettings.markets
  notes                  String?              @db.Text
  isActive               Boolean              @default(true) @map("is_active")
  // relationship
  ownerUserId            String?              @map("owner_user_id")
  priority               OrganizationPriority?
  stage                  PartnerStage         @default(TARGET)
  stageChangedAt         DateTime             @default(now()) @map("stage_changed_at")
  lastContactAt          DateTime?            @map("last_contact_at")      // max(Interaction.occurredAt); maintained by interactions.ts
  nextFollowUpAt         DateTime?            @map("next_follow_up_at")    // display only: set from the "create follow-up task" checkbox
  potentialAnnualRevenue Decimal?             @map("potential_annual_revenue") @db.Decimal(12, 2)
  paymentTermsDays       Int?                 @map("payment_terms_days")
  // GC profile (nullable; shown on a card for GENERAL_CONTRACTOR / DEVELOPER / PROPERTY_MANAGER)
  annualVolume           String?              @map("annual_volume")
  companySize            String?              @map("company_size")
  projectTypes           String[]             @default([]) @map("project_types")
  typicalProjectSize     String?              @map("typical_project_size")
  biddingPlatform        String?              @map("bidding_platform")
  prequalPlatform        String?              @map("prequal_platform")
  vendorRegistrationUrl  String?              @map("vendor_registration_url")
  requirementsNotes      String?              @map("requirements_notes") @db.Text
  vendorId               String?              @map("vendor_id")            // the same company as a payee, if ever
  createdByUserId        String               @map("created_by_user_id")
  createdAt              DateTime             @default(now()) @map("created_at")
  updatedAt              DateTime             @updatedAt @map("updated_at")

  owner        User?   @relation("OrganizationOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
  createdBy    User    @relation("OrganizationCreatedBy", fields: [createdByUserId], references: [id])
  vendor       Vendor? @relation(fields: [vendorId], references: [id], onDelete: SetNull)
  trades       OrganizationTrade[]
  contacts     Contact[]
  interactions Interaction[]
  stageHistory PartnerStageHistory[]
  leads        Lead[]
  tasks        Task[]

  @@index([stage])
  @@index([ownerUserId])
  @@index([lastContactAt])
  @@map("organizations")
}

model OrganizationTrade {
  organizationId    String @map("organization_id")
  serviceCategoryId String @map("service_category_id")
  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  serviceCategory ServiceCategory @relation(fields: [serviceCategoryId], references: [id])
  @@id([organizationId, serviceCategoryId])
  @@map("organization_trades")
}

model Contact {
  id                   String       @id @default(cuid())
  organizationId       String       @map("organization_id")
  firstName            String       @map("first_name")
  lastName             String       @map("last_name")
  title                String?
  roleTag              ContactRole  @default(OTHER) @map("role_tag")
  email                String?
  phone                String?
  mobile               String?
  linkedinUrl          String?      @map("linkedin_url")
  office               String?
  geography            String?
  trades               String[]     @default([])
  relationshipStrength Int?         @map("relationship_strength")   // CHECK 1..5
  influence            Int?                                          // CHECK 1..5
  isPrimary            Boolean      @default(false) @map("is_primary") // partial unique per org
  isActive             Boolean      @default(true) @map("is_active")
  lastContactAt        DateTime?    @map("last_contact_at")
  notes                String?      @db.Text
  createdByUserId      String       @map("created_by_user_id")
  createdAt            DateTime     @default(now()) @map("created_at")
  updatedAt            DateTime     @updatedAt @map("updated_at")

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User          @relation("ContactCreatedBy", fields: [createdByUserId], references: [id])
  interactions Interaction[]
  leads        Lead[]

  @@index([organizationId])
  @@index([email])
  @@index([phone])
  @@map("contacts")
}

model Interaction {
  id             String               @id @default(cuid())
  organizationId String               @map("organization_id")
  contactId      String?              @map("contact_id")
  leadId         String?              @map("lead_id")                 // set when the interaction is about a bid
  userId         String               @map("user_id")                 // who had it
  kind           InteractionKind
  direction      InteractionDirection @default(OUTBOUND)
  outcome        InteractionOutcome   @default(NOT_APPLICABLE)
  occurredAt     DateTime             @map("occurred_at")
  summary        String               @db.Text
  createdAt      DateTime             @default(now()) @map("created_at")
  updatedAt      DateTime             @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  contact      Contact?     @relation(fields: [contactId], references: [id], onDelete: SetNull)
  lead         Lead?        @relation(fields: [leadId], references: [id], onDelete: SetNull)
  user         User         @relation("InteractionUser", fields: [userId], references: [id])

  @@index([organizationId, occurredAt])
  @@index([contactId])
  @@index([leadId])
  @@map("interactions")
}

model PartnerStageHistory {
  id              String        @id @default(cuid())
  organizationId  String        @map("organization_id")
  fromStage       PartnerStage? @map("from_stage")
  toStage         PartnerStage  @map("to_stage")
  reason          String?
  changedByUserId String        @map("changed_by_user_id")
  changedAt       DateTime      @default(now()) @map("changed_at")
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  changedBy    User         @relation("PartnerStageChangedBy", fields: [changedByUserId], references: [id])
  @@index([organizationId, changedAt])
  @@map("partner_stage_history")
}

model PartnerSettings {
  id                        String   @id @default("default")
  newTargetDays             Int      @default(5)  @map("new_target_days")        // working days
  noResponseDays            Int      @default(7)  @map("no_response_days")
  qualSubmittedDays         Int      @default(14) @map("qual_submitted_days")     // used from Stage 2
  prequalNoBidDays          Int      @default(30) @map("prequal_no_bid_days")     // Stage 2
  activeQuietDays           Int      @default(60) @map("active_quiet_days")
  dormantAfterDays          Int      @default(180) @map("dormant_after_days")     // Stage 4 health cap
  defaultOwnerUserId        String?  @map("default_owner_user_id")
  markets                   String[] @default([])                                  // seeded FL counties
  updatedAt                 DateTime @updatedAt @map("updated_at")
  defaultOwner User? @relation("PartnerDefaultOwner", fields: [defaultOwnerUserId], references: [id], onDelete: SetNull)
  @@map("partner_settings")
}

// Lead additions
//   kind           LeadKind @default(CUSTOMER)   @@index([kind])
//   organizationId String?  @map("organization_id")  → Organization (SetNull)   @@index
//   contactId      String?  @map("contact_id")       → Contact (SetNull)
// Task addition
//   organizationId String?  @map("organization_id")  → Organization (SetNull)   @@index
// Back-relations on User (owner, createdBy ×2, interactions, stage history, default owner), ServiceCategory, Vendor.
```

Hand-appended SQL (after the generated statements):

```sql
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_strength_chk" CHECK (relationship_strength IS NULL OR relationship_strength BETWEEN 1 AND 5);
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_influence_chk" CHECK (influence IS NULL OR influence BETWEEN 1 AND 5);
CREATE UNIQUE INDEX "contacts_one_primary_per_org" ON "contacts"("organization_id") WHERE is_primary;
```

`Lead.kind` is `NOT NULL DEFAULT 'CUSTOMER'`, so the column backfills itself.

### 1.2 Seeds (`prisma/seed-partners.ts`, idempotent, prints created / unchanged)

1. `ServiceCategory` upsert by name (top level, `parentId null`): **Plumbing**,
   **Demolition**, **General Construction** (children none). Existing rows
   untouched.
2. `LeadSource` upsert by name **"GC bid invitation"**, `channelType DIRECT`.
3. `PartnerSettings` create-only (`upsert … update: {}`) with
   `markets = ["Miami-Dade","Broward","Palm Beach","St. Lucie","Orange","Brevard","Hillsborough","Pinellas","Martin","Hendry","Lee","Collier"]`.

Runnable on prod with the same `npx tsx prisma/seed-partners.ts` wrapper as
the other seeds; CLAUDE.md §7 gets the line.

### 1.3 Pure modules (client-safe, tested)

**`src/lib/partners/stages.ts`**
```ts
export const PARTNER_STAGES: readonly { key: PartnerStage; name: string; stageOrder: number; isClosed: boolean; hint: string }[]
//  TARGET 1 · CONTACTED 2 · ENGAGED 3 · ACTIVE 4 · DORMANT 5 (isClosed) · DO_NOT_PURSUE 6 (isClosed)
export function stageDef(key: PartnerStage)
export function stagesAsStageLike(): StageLike[]        // for buildStageToneMap / StageStepper / kanban columns
export const STAGE_TERMINAL: ReadonlySet<PartnerStage>   // DORMANT, DO_NOT_PURSUE
```
Tests: order is strictly increasing; the two terminal stages are `isClosed`;
`stagesAsStageLike()` carries `id = key`.

**`src/lib/partners/derive.ts`** — badges and facts computed on read.
```ts
export type OrgFacts = {
  stage: PartnerStage; lastContactAt: Date | null; createdAt: Date;
  interactionCount: number; openBidCount?: number; bidCount?: number; awardedCount?: number; jobCount?: number;
  qualification?: { status: QualificationStatus; expiresAt: Date | null } | null;   // Stage 2
};
export type OrgBadge = { key: "quiet" | "first-bid" | "bidding" | "awarded" | "repeat" | "prequal-pending" | "prequalified" | "prequal-expiring" | "preferred"; label: string; tone: Tone };
export function daysSince(d: Date | null, now: Date): number | null
export function orgBadges(f: OrgFacts, now: Date, s: { activeQuietDays: number; prequalExpiringDays?: number }): OrgBadge[]
export function quietDays(f: OrgFacts, now: Date): number | null  // days since last contact, null when never
```
Tests: never contacted → `quiet` only when `stage ≠ TARGET` and age > threshold;
`quiet` label "Quiet 63 days"; `repeat` needs `jobCount ≥ 2`; badges are
ordered by severity (danger → warning → info → success); Stage 2 keys absent
when `qualification` is undefined.

**`src/lib/partners/follow-ups.ts`** — rule planner.
```ts
export type FollowUpRule = "new-target" | "no-response" | "qual-submitted" | "prequal-no-bids" | "quiet";
export type FollowUpInput = {
  org: { id: string; name: string; stage: PartnerStage; createdAt: Date; ownerUserId: string | null; lastContactAt: Date | null };
  lastInteraction: { id: string; kind: InteractionKind; direction: InteractionDirection; outcome: InteractionOutcome; occurredAt: Date; contactName: string | null } | null;
  interactionCount: number;
  qualification?: { status: QualificationStatus; submittedAt: Date | null; approvedAt: Date | null } | null;  // Stage 2
  lastBidActivityAt?: Date | null;                                                                              // Stage 3
};
export type PlannedFollowUp = { sourceKey: string; rule: FollowUpRule; title: string; description: string; priority: Priority; dueDay: DayKey };
export const followUpPrefix = (orgId: string) => `org:${orgId}:followup:`;
export function followUpKey(orgId: string, rule: FollowUpRule, anchor: string, period: number): string   // `${prefix}${rule}@${anchor}#${period}`
export function planFollowUps(input: FollowUpInput, today: DayKey, s: PartnerSettingsThresholds): PlannedFollowUp[]
export function liveFollowUpKeys(input: FollowUpInput, today: DayKey, s: PartnerSettingsThresholds): Set<string>
```
Rule semantics (Stage 1 implements 1, 2, 5; 3–4 arrive with Stage 2):

| Rule | Fires when | Anchor | Period | Title |
|---|---|---|---|---|
| new-target | `stage = TARGET`, `interactionCount = 0`, `workingDaysBetween(createdDay, today) ≥ newTargetDays` | `createdDay` | `floor(wd / newTargetDays)` | "{org}: first contact overdue — added {date}, nobody has reached out" |
| no-response | last interaction `OUTBOUND` with outcome in `NO_ANSWER, LEFT_MESSAGE, SENT` and `daysBetween ≥ noResponseDays`; stage not terminal | `lastInteraction.id` | `floor(days / noResponseDays)` | "{org}: no reply to your {kind} on {date} — follow up with {contact or 'them'}" |
| quiet | `stage = ACTIVE`, `daysSince(lastContactAt) ≥ activeQuietDays` (never contacted counts as since `createdAt`) | `"active"` | `floor(days / activeQuietDays)` | "{org}: quiet for {n} days — schedule a check-in" |

Priority HIGH for all three; `dueDay = today`. A rule's key is live while its
condition holds; `liveFollowUpKeys` is what `settle` compares against.
Working days: new `src/lib/time/working-days.ts` with `addWorkingDays(day, n)`
and `workingDaysBetween(a, b)` (Mon–Fri; holidays deliberately ignored, as in
`src/lib/crews/install.ts`), `previousWorkingDay` moved there and re-exported
from `install.ts`.

Tests (`follow-ups.test.ts`): each rule fires exactly at its threshold and not
the day before; the period in the key increments at 2× the threshold; a
terminal stage plans nothing; an INBOUND last interaction never plans
no-response; `liveFollowUpKeys` of a satisfied org is empty; keys are stable
across calls on the same day; working days skip a weekend.

**`src/lib/partners/query.ts`**
```ts
export type OrgListParams = { search?: string; stage?: PartnerStage; ownerUserId?: string; market?: string; tradeId?: string; kind?: OrganizationKind; includeInactive?: boolean; scope: ListScope; page: number; pageSize: number; sort?: "name" | "lastContact" | "stage" };
export function parseOrgListParams(sp: URLSearchParams): OrgListParams
export function buildOrgListWhere(p: OrgListParams, ctx: { user: { id: string; role: RoleName } }): Prisma.OrganizationWhereInput
//  scope MINE → ownerUserId = me; search ORs name, city, contacts.firstName/lastName/email, website
export type ContactListParams = { search?: string; organizationId?: string; roleTag?: ContactRole; geography?: string; trade?: string; ownerUserId?: string; lastContactBefore?: DayKey; page; pageSize }
export function buildContactListWhere(p: ContactListParams): Prisma.ContactWhereInput
```
Tests: default excludes inactive; `scope=mine` adds the owner clause; search
is case-insensitive; `lastContactBefore` maps to `lte` on the pinned day.

**`src/lib/partners/access.ts`**
```ts
export const PARTNER_VIEW_ROLES   = ["ADMIN","MANAGER","OFFICE_STAFF","SALES_REP","MARKETING","READ_ONLY"] as const;
export const PARTNER_MANAGE_ROLES = ["ADMIN","MANAGER","OFFICE_STAFF","SALES_REP"] as const;   // [ruling 2: SALES_REP]
export const PARTNER_ADMIN_ROLES  = ["ADMIN","MANAGER"] as const;
export function canViewPartners(role), canManagePartners(role), canAdminPartners(role)   // owner change, DO_NOT_PURSUE, delete, settings
export function partnerPermissions(user): { canManage; canAdmin; canViewMoney (Stage 3: ADMIN, MANAGER, OFFICE_STAFF, READ_ONLY) }
export const PARTNER_DENIED_MESSAGE = "You do not have access to Business Development records."
```
Tests: the full role × predicate matrix; CREW_LEAD denied everywhere.

**`src/lib/partners/validation.ts`** (zod 4; every `.optional()` on a patch
uses `.nullish()` where the UI may send null — the 2026-10-04 lesson)
```ts
createOrganizationSchema = { name: string.min(2).max(120), kind: enum, website?: url-ish, phone?, email?: email, address1?, address2?, city?, state?: length 2, zipCode?, localOffices?, markets?: string[], notes?, ownerUserId?: cuid, priority?: enum, stage?: enum (default TARGET), potentialAnnualRevenue?: number ≥ 0, paymentTermsDays?: int 0..180, annualVolume?, companySize?, projectTypes?: string[], typicalProjectSize?, biddingPlatform?, prequalPlatform?, vendorRegistrationUrl?, requirementsNotes?, tradeIds?: cuid[], vendorId?: cuid }
updateOrganizationSchema = createOrganizationSchema.partial() (no stage — stage has its own route)
stageChangeSchema = { stage: enum, reason?: string.max(500) }      // reason required when → DO_NOT_PURSUE
ownerChangeSchema = { ownerUserId: cuid | null }
createContactSchema = { firstName, lastName, title?, roleTag?, email?, phone?, mobile?, linkedinUrl?, office?, geography?, trades?: string[], relationshipStrength?: int 1..5, influence?: int 1..5, isPrimary?: bool, notes? }   (at least one of email/phone/mobile)
updateContactSchema = partial + isActive?
createInteractionSchema = { contactId?: cuid, leadId?: cuid, kind: enum, direction: enum (default OUTBOUND), outcome: enum, occurredAt: ISO (default now, not in the future by > 1 h), summary: string.min(1).max(4000), followUp?: { title: string, dueDay: DayKey, assignedUserId?: cuid } }
updateInteractionSchema = pick(kind, direction, outcome, occurredAt, summary, contactId)
settingsSchema = { newTargetDays: int 1..60, noResponseDays: int 1..60, qualSubmittedDays, prequalNoBidDays, activeQuietDays: int 1..365, dormantAfterDays: int 30..730, defaultOwnerUserId: cuid | null, markets: string[] (unique, trimmed, 1..60 chars) }
export function partnerErrorResponse(err): NextResponse   // PartnerError → its status; zod → 400 with "field: what is wrong"; else 500 logged
```
Tests: `isPrimary` boolean coercion; outcome required; a future `occurredAt`
rejected; `reason` required for DO_NOT_PURSUE (refined).

### 1.4 Services (Prisma; `src/lib/partners/*`)

**`service.ts`**
```ts
export class PartnerError extends Error { constructor(public status: number, message: string) }
export function normaliseNameKey(name: string): string
export async function createOrganization(input, actorUserId): Promise<OrgDetail>     // 409 on nameKey clash; writes trades; audit "Organization" create; initial PartnerStageHistory (from null → stage)
export async function updateOrganization(id, patch, actorUserId)                      // 409 on nameKey clash with another row; audit update with before/after of changed keys only
export async function changeStage(id, stage, reason, actorUserId)                     // no-op if same; history row; stageChangedAt; audit "stage_change"; then settlePartnerFollowUps
export async function changeOwner(id, ownerUserId | null, actorUserId)                // 400 if the user is inactive; audit "owner_change"; open follow-up tasks for the org are reassigned to the new owner (updateTask, internal quiet)
export async function deleteOrganization(id, actorUserId)                             // 409 when leads, bids or jobs reference it; cascades contacts/interactions/history; audit with a snapshot
export async function listOrganizations(params, ctx): Promise<{ rows: OrgRow[]; total: number; canManage: boolean }>
//   OrgRow = { id, name, kind, stage, priority, owner {id, firstName, lastName} | null, markets, trades [{id,name}], primaryContact {id, name, title, phone, email} | null,
//              lastContactAt, nextOpenTask { id, title, dueAt } | null, interactionCount90d, badges: OrgBadge[], isActive }
export async function getOrganizationDetail(id, viewer): Promise<OrgDetail>          // org + trades + contacts (active first) + last 20 interactions + stage history + open tasks + badges + permissions
```
**`contacts.ts`**: `createContact` (409 if `isPrimary` and another primary
exists → the service clears the old one inside a transaction, not an error),
`updateContact`, `deactivateContact`, `listContacts`. Audit entity "Contact".

**`interactions.ts`**
```ts
export async function logInteraction(orgId, input, actorUserId): Promise<InteractionRow>
```
In one transaction: insert the row (`userId = actorUserId`); `Organization.lastContactAt = max(existing, occurredAt)`;
`Contact.lastContactAt` likewise when `contactId`; if `input.leadId` →
`ActivityLog { leadId, activityType: CALL_LOGGED | EMAIL_LOGGED | NOTE (by kind), title: "<kind> with <org>", description: summary, metadataJson: { interactionId } }`
(the `logCaseCommunication` bridge); if `input.followUp` → `createTask({ title, dueAt: pinAllDay(dueDay), allDay: true, assignedUserId: followUp.assignedUserId ?? org.ownerUserId ?? actor, createdByUserId: actor, organizationId: orgId, leadId: input.leadId, source: "manual" })`
and `Organization.nextFollowUpAt = dueAt`. After commit: `settlePartnerFollowUps(orgId, actorUserId)`; audit "Interaction" create.
`updateInteraction` / `deleteInteraction` (author or admin roles) recompute
`lastContactAt` from the remaining rows.

**`follow-up-run.ts`** (copy of `vendors/alert-run.ts`)
```ts
export async function followUpOwnerId(org): Promise<string | null>    // org.owner (active) → PartnerSettings.defaultOwner (active) → oldest active ADMIN
export async function raisePartnerFollowUps(today = todayKey()): Promise<{ organizations: number; raised: number; byRule: Record<FollowUpRule, number> }>
//   for every active org not in a terminal stage: load FollowUpInput (one query per table, batched by org ids), planFollowUps, raise() each —
//   raise skips when any task with that sourceKey ever existed; createTask({ …, organizationId, source: "auto", sourceKey }, { actorUserId: null, notify: "inline" })
export async function settlePartnerFollowUps(orgId, actorUserId, because = "An interaction was logged"): Promise<number>
//   open tasks with sourceKey startsWith followUpPrefix(orgId) whose key ∉ liveFollowUpKeys → updateTask COMPLETED (internal quiet), TaskEvent AUTO_CLOSED with `because`
```
Cron route `src/app/api/cron/partner-follow-ups/route.ts`: `requireCronSecret`,
`?dryRun=1` returns the plan without writing. Wrapper
`crm-cron/partner-follow-ups.sh`, crontab `55 11 * * 1-5`.

**`settings.ts`**: `getPartnerSettings()` (creates the default row lazily, like
`notification_settings`), `updatePartnerSettings(patch, actor)` (audit
"PartnerSettings" update).

### 1.5 The fence (six call sites)

| File | Change |
|---|---|
| `src/lib/leads/query.ts` | `LeadListParams.kind?: "CUSTOMER" \| "GC_BID" \| "ALL"` parsed from `?kind=`; `buildLeadListWhere` adds `kind: params.kind === "ALL" ? undefined : (params.kind ?? "CUSTOMER")`. Test: `buildLeadListWhere({}, ctx).kind === "CUSTOMER"`. |
| `src/lib/nurture/run.ts` | enrol `where` gains `kind: "CUSTOMER"`; reconcile step STOPs an ACTIVE/PAUSED state whose lead is `GC_BID` (reason `"gc bid"`). Test on the pure `decideAction` is unaffected; an integration test in the QA script asserts the dry run lists no `GC_BID` lead. |
| `src/lib/follow-ups/events.ts` | `emitLeadEvent` loads `lead.kind` and returns early for `GC_BID`. |
| `src/lib/attention/load.ts` | `overdueFollowUpsWhere` adds `kind: "CUSTOMER"`. |
| `src/lib/reports/dashboard-scope.ts` + `src/app/api/reports/route.ts` | `dashboardLeadWhere` adds `kind: "CUSTOMER"`; the two inline lead queries (overdue count, funnel cohort) take the same where. |
| `src/lib/search/format.ts` | lead hits with `kind === "GC_BID"` render `primary = "Bid · <companyName>"`, `secondary = address`, `href = /leads/<id>?tab=bid` (Stage 3 adds the number). `SearchRows.leads` select gains `kind, companyName`. |

Also: `LEAD_LABEL_SELECT` gains `kind`; `customerName()` in
`src/lib/labels/job.ts` returns `companyName` first when `kind === "GC_BID"`
(test added).

### 1.6 Task plumbing

- `CreateTaskInput.organizationId?`; `resolveParentLinks` leaves it as-is (an
  org has no lead); `TASK_LIST_INCLUDE` adds `organization: { select: { id: true, name: true } }`.
- `SubjectKind` gains `"organization"` after `vendor`; `subjectLabel` returns
  `{ primary: org.name, kind: "organization", href: /partners/<id> }`;
  `subjectText` "for <org>".
- `task-entity-chip.tsx` `ICONS.organization = Building2`.
- `src/lib/tasks/query.ts` `LINK_PARAMS` gains `organizationId` so the GC page's
  task list can filter (`/api/tasks?organizationId=`).
- Task visibility: unchanged (own-only roles see tasks assigned to or created
  by them; partner tasks are assigned to the owner).

### 1.7 API contracts

Common: 401 unauthenticated, 403 `{error: PARTNER_DENIED_MESSAGE}`, 404 unknown
id, 409 `{error, hint?}` on conflicts, 400 `{error: "field: what is wrong"}`.

| Route | Method | Body / query | Response |
|---|---|---|---|
| `/api/partners` | GET | `search, stage, owner, market, trade, kind, inactive=1, scope, page, pageSize, sort` | `{ rows: OrgRow[], total, canManage }` |
| | POST | `createOrganizationSchema` | 201 `OrgDetail` |
| `/api/partners/[id]` | GET | — | `OrgDetail` + `permissions` |
| | PATCH | `updateOrganizationSchema` | `OrgDetail` |
| | DELETE | — (canAdmin) | 204 · 409 `{error, blockers: {leads, bids, jobs}}` |
| `/api/partners/[id]/stage` | POST | `{stage, reason?}` | `{ stage, stageChangedAt, history: [...] }` |
| `/api/partners/[id]/owner` | POST (canAdmin) | `{ownerUserId}` | `{ owner }` |
| `/api/partners/[id]/contacts` | GET / POST | `createContactSchema` | `{ contacts }` / 201 contact |
| `/api/contacts/[id]` | PATCH / DELETE | `updateContactSchema` | contact / 204 (soft: `isActive=false`) |
| `/api/partners/contacts` | GET | `ContactListParams` | `{ rows: ContactRow[], total }` (`ContactRow` carries org name/stage/owner) |
| `/api/partners/[id]/interactions` | GET / POST | `page`; `createInteractionSchema` | `{ rows }` / 201 `{ interaction, task? }` |
| `/api/interactions/[id]` | PATCH / DELETE | `updateInteractionSchema` | row / 204 |
| `/api/partners/settings` | GET / PUT (canAdmin) | `settingsSchema` | settings |
| `/api/partners/options` | GET | — | `{ stages, kinds, roles, interactionKinds, outcomes, markets, trades, owners }` (for selects; `items` arrays with label/value) |
| `/api/cron/partner-follow-ups` | POST | `?dryRun=1` | `{ organizations, raised, byRule }` |
| `/api/leads/contact-lookup` | GET | `phone` / `email` | existing shape + `contacts: [{ id, name, organization: {id, name} }]` |
| `/api/search` | GET | `q` | hits gain `type: "organization" \| "contact"` |

### 1.8 UI

**Sidebar** (`src/components/layout/sidebar.tsx`): section
`{ key: "business-development", label: "Business Development", icon: Handshake, roles: PARTNER_VIEW_ROLES, items: [ {href:"/partners", label:"GC Partnerships", icon: Building2, match:"exact"}, {href:"/partners/contacts", label:"Contacts", icon: Users} ] }`
placed after Code Violations. Later stages append Qualifications, Bids, Bid
Calendar, Document Vault, Analytics. Admin section gains "Business Development
Settings" → `/admin/partners`.

**`/partners`** (`src/app/(dashboard)/partners/page.tsx`): `PageHeader`
("GC Partnerships", "+ New GC"), `ListToolbar` (Mine = "My accounts", search,
filters stage / owner / market / trade / kind / show inactive, clear), view
toggle Table | Board (`?view=board`). Table columns: Name (link, kind under
it), Stage (`StagePillSelect` over `stagesAsStageLike()`, canManage only),
Owner (avatar + name), Primary contact (name · phone `tel:`), Last touch
("12 d ago", red past `activeQuietDays`), Next task (title · due), Badges,
Markets. Sort by name / last touch. Below `md`: Name, Stage, Last touch only.
CSV export of the visible rows. Empty state "No GC accounts yet — add the first
one". Board: `KanbanBoard` with columns from `PARTNER_STAGES` through
`buildStageToneMap`, `getColumnId = stage`, `onMove` → POST stage with
`useOptimisticMove`; DO_NOT_PURSUE requires the reason dialog (`ConfirmDialog`
with a textarea) before the move is sent; cards show name, owner avatar, last
touch, first badge.

**`/partners/[id]`**: `EntityHeader` (breadcrumb Business Development → GC
Partnerships → name; title name; subtitle kind · city · markets; badges from
`derive.ts`; actions: Log interaction (brand), Edit, ⋯ menu with Change owner
/ Mark do-not-pursue / Delete (admin)). `StageStepper` over the six stages with
`confirmNote` on DORMANT / DO_NOT_PURSUE. Tabs in `?tab=`: **overview**
(cards: Relationship — owner, priority, stage since, last touch, next open
task with "Done" inline; Contacts — primary + count; Profile — the GC columns;
Recent activity — last 5 interactions; Open tasks list from
`/api/tasks?organizationId=`), **contacts** (table + "Add contact"; row menu
Edit / Make primary / Deactivate; phone and email as `tel:` / `mailto:`),
**activity** (interactions newest first with kind icon, direction arrow,
outcome chip, user, contact, summary; filter by kind; Edit/Delete on own rows;
stage history interleaved as muted rows). Phone layout: tabs above cards,
action row sticky at the bottom with Log interaction.

**Dialogs** (`src/components/partners/*`): `org-form-dialog.tsx` (two
sections: Company, Relationship; GC profile section collapsed by default;
Base UI `Select`s all take `items`), `contact-form-dialog.tsx`,
`interaction-dialog.tsx` (contact select limited to the org's contacts, kind
chips, direction toggle, outcome radio — required, date defaults now with a
"Yesterday" preset, summary textarea with autofocus, "Create a follow-up task"
checkbox revealing title + due presets Tomorrow / 3 days / 1 week / 2 weeks +
assignee defaulting to the owner), `owner-dialog.tsx`, `stage-badges.tsx`,
`use-partners.ts` (`useOrganizations`, `useOrganization`, `useLogInteraction`,
`useChangeStage`, `usePartnerOptions`; keys `["partners", …]`; mutations
invalidate `["partners"]` and `["tasks"]`).

**`/partners/contacts`**: table (Name, Title / role, Company → link, Phone,
Email, Geography, Trades, Last touch, Owner of the account), filters company /
role / geography / trade / owner / "no contact in 60 days"; "Add contact"
opens the dialog with a company picker.

**`/admin/partners`**: thresholds (number inputs with hints), default owner
select, markets editor (chips add/remove). Save → PUT; toast.

**⌘K**: groups "GC partners" (Building2) and "Contacts" (Users) in
`command-palette.tsx` `ICONS` / `GROUPS`; search route adds the two queries
(5 each) through `buildOrgListWhere` / `buildContactListWhere`.

### 1.9 Backfill (`scripts/backfill-partners-coastal-choice.ts`)

Dry run by default; `--apply` writes; `--fix-billing` additionally patches the
job. Steps, each printed:
1. Find the job: `jobNumber = "JOB-00009"`, else `title contains "Towne Place
   Suites"`; abort if none or if its lead already has `organizationId`.
2. Upsert `Organization` on `nameKey "coastal choice construction"`: name
   "Coastal Choice Construction", kind GENERAL_CONTRACTOR, address from the
   lead's mailing address, stage ACTIVE, owner = the job's `salesRepId` or
   `projectManagerId` or oldest admin, trades [Drywall], `createdByUserId` =
   owner. Stage history row from null → ACTIVE, reason "backfill".
3. Patch the lead: `kind GC_BID`, `organizationId`; `companyName` untouched.
4. Print `billingMethod`, `retainagePercent`, `contractAmount`; with
   `--fix-billing` set PROGRESS / 10 (audit `pricing_update`).
5. Re-run → "already linked, nothing to do".
Run on prod after the Stage 1 deploy (dry run, then `--apply`); the
`--fix-billing` flag only on Richard's word after he reads the printed values.

### 1.10 Tests, QA, operator steps

Unit: `stages`, `derive`, `follow-ups`, `query`, `access`, `validation`,
`working-days`, `leads/query` (fence), `labels/job` (`customerName`),
`labels/subject` (organization kind). Target ≈ +45 tests.

API QA script (dev, as ADMIN then SALES_REP): create org (201) → duplicate
name (409) → add two contacts, second primary clears the first → log an
OUTBOUND call NO_ANSWER → cron dry run plans nothing (day 0) → set the
interaction's `occurredAt` back 8 days by PATCH → cron raises `no-response`
once (second run 0) → log an INBOUND reply → the task is COMPLETED with
`AUTO_CLOSED` → stage → DO_NOT_PURSUE without reason 400, with reason 200 and
a history row → delete org with a lead attached 409 → `/api/leads` default
omits a `GC_BID` lead, `?kind=ALL` shows it → nurture `?dryRun=1` lists no
`GC_BID` lead → `/api/reports` lead counts exclude it → SALES_REP: list 200,
create 201 **[ruling 2]**, owner change 403, settings 403 → MARKETING: create
403 → CREW_LEAD: 403.

Headless Chromium at 1280 and 400 px: `/partners` table and board (drag a
card → stage changes, DO_NOT_PURSUE prompts), `/partners/[id]` three tabs,
log-interaction dialog with the follow-up checkbox (task appears under Open
tasks and on `/tasks`), `/partners/contacts`, `/admin/partners`; no console
errors; ⌘K finds the org and the contact.

Operator after deploy: seed (dry run has no flag — the seed prints
created/unchanged; run once), backfill dry run → `--apply`, install
`partner-follow-ups.sh` + crontab line, run it once by hand (`raised 0`
expected on day one), CLAUDE.md §7 lines.

---

## Stage 2 — Qualifications and the document vault

### 2.1 Schema

```prisma
enum QualificationStatus { NOT_STARTED IN_PROGRESS SUBMITTED INFO_REQUESTED APPROVED REJECTED }
enum RequirementStatus { PENDING ACCEPTED REJECTED WAIVED }
enum DocumentConfidentiality { INTERNAL RESTRICTED SHAREABLE }

model CompanyDocumentType {
  id String @id @default(cuid()); key String @unique; name String; category String   // "insurance" | "licensing" | "safety" | "financial" | "company"
  defaultValidityMonths Int?; isActive Boolean @default(true); sortOrder Int @default(0); createdAt; updatedAt
  documents CompanyDocument[]; requirements QualificationRequirement[]
  @@map("company_document_types")
}
model CompanyDocument {
  id, documentTypeId, title String, version Int @default(1), effectiveDate DateTime?, expiresAt DateTime?,
  confidentiality DocumentConfidentiality @default(INTERNAL), approvedForExternal Boolean @default(false),
  supersedesId String?, notes String? @db.Text,
  fileName String, fileType String, fileSize Int, storageKey String, encryptedKeyVersion Int?,   // non-null ⇒ bytes encrypted
  uploadedByUserId String, createdAt, updatedAt
  supersedes CompanyDocument? @relation("DocVersions", fields: [supersedesId], references: [id], onDelete: SetNull); newer CompanyDocument[] @relation("DocVersions")
  requirements QualificationRequirement[]
  @@unique([documentTypeId, version]) @@index([expiresAt]) @@map("company_documents")
}
model Qualification {
  id, organizationId, platform String?, portalUrl String?, portalUsernameHint String?, ownerUserId String?,
  status QualificationStatus @default(NOT_STARTED), submittedAt?, approvedAt?, expiresAt?, renewalDueAt?, notes? @db.Text,
  createdByUserId, createdAt, updatedAt
  requirements QualificationRequirement[]
  @@index([organizationId, status]) @@index([expiresAt]) @@map("qualifications")
}
model QualificationRequirement {
  id, qualificationId, documentTypeId, required Boolean @default(true), status RequirementStatus @default(PENDING),
  companyDocumentId String?, providedAt DateTime?, notes String?, sortOrder Int @default(0), createdAt, updatedAt
  @@unique([qualificationId, documentTypeId]) @@map("qualification_requirements")
}
// PartnerSettings +: vaultOwnerUserId String?, defaultRequirementTypeKeys String[] @default([])
// User +: canViewRestrictedDocuments Boolean @default(false)      [ruling 2]
```
Hand SQL: `CHECK (version >= 1)`; `CHECK (expires_at IS NULL OR effective_date IS NULL OR expires_at >= effective_date)`.

### 2.2 Seeds

`CompanyDocumentType` upsert by key (update `{}`): `w9 · gl_coi · wc_coi ·
auto_coi · umbrella_coi · contractor_license · trade_license · safety_program ·
osha_300 · emr_letter · financial_statements · banking_letter · bonding_letter ·
references · project_history · capabilities_statement`, with categories and
`defaultValidityMonths` (COIs 12, licences 24, EMR 12, financials 12, others
null). `PartnerSettings.defaultRequirementTypeKeys` create-only default =
`[w9, gl_coi, wc_coi, auto_coi, contractor_license, safety_program, emr_letter, references]`.

### 2.3 Pure modules

**`qualification-state.ts`**
```ts
export type DerivedQualStatus = QualificationStatus | "EXPIRED" | "RENEWAL_DUE";
export function deriveQualificationStatus(q: { status; expiresAt; renewalDueAt }, today: DayKey): DerivedQualStatus
//   APPROVED & expiresAt < today → EXPIRED; APPROVED & renewalDueAt ≤ today → RENEWAL_DUE; else status
export type RequirementState = "missing" | "provided" | "expired" | "accepted" | "rejected" | "waived";
export function requirementState(r, doc: { expiresAt } | null, today): RequirementState
export function coverage(reqs): { required: number; satisfied: number; missing: string[] }   // satisfied = accepted or provided-and-not-expired, or waived
```
Tests: boundary day counts as expired; WAIVED counts satisfied even without a
document; REJECTED never satisfied.

**`document-alerts.ts`** (copy of `vendors/alerts.ts`): prefix
`company-doc:`, keys `company-doc:<docId>:<expiring|expired>@<day>`, watch only
the **current** version per type; expiring HIGH due 14 days before; expired
URGENT due today; description lists "Used by: <org names>" from the
requirement rows. Plus qualification keys `org:<id>:qual:<qid>:<expiring|expired|renewal>@<day>`.
`liveDocumentAlertKeys(docs, reqs, today)`.

**`vault-access.ts`**
```ts
export function canReadDocument(user: { role; canViewRestrictedDocuments }, doc: { confidentiality }): boolean
//   SHAREABLE: PARTNER_VIEW_ROLES; INTERNAL: view roles minus MARKETING; RESTRICTED: ADMIN, or MANAGER/OFFICE_STAFF with the grant   [ruling 2]
export function canUploadVault(role)   // ADMIN, MANAGER, OFFICE_STAFF
export function canSetConfidentiality(role)   // ADMIN, MANAGER
```
Follow-ups: rules 3 and 4 added to `follow-ups.ts` (`qual-submitted` anchored
on `submittedAt` day; `prequal-no-bids` anchored on `max(approvedAt,
lastBidActivityAt)`, Stage 3 supplies `lastBidActivityAt`, until then
`approvedAt`).

### 2.4 Services

**`documents.ts`**: `uploadDocument(form, actor)` — validates MIME/size with
`src/lib/files/limits.ts`; version = max per type + 1; `supersedesId` = the
previous current; RESTRICTED → `encryptWithKeyring(bytes, aad "company-document:<id>")`
stored with `encryptedKeyVersion`; `saveFile` for the bytes; audit
`document_upload`. `readDocumentBytes(id)` decrypts when needed.
`updateDocument` (title, dates, notes, confidentiality, approvedForExternal;
audit `confidentiality_change` / `approved_for_external` with before/after).
`deleteDocument` — refused (409) when any requirement references it; else row
first, then the file. Every write → `settleDocumentAlerts(actor)`.
`usedBy(docId)` → `[{ organization, qualification, requirementStatus }]`.

**`qualifications.ts`**: `createQualification(orgId, input, actor)` with the
default requirement set unless `requirementTypeKeys` is given;
`updateQualification` (status transitions free-form but audited
`qualification_status` with before/after; `submittedAt` auto-stamped on →
SUBMITTED, `approvedAt` on → APPROVED, `expiresAt` defaulted from the type's
`defaultValidityMonths` of the longest requirement when empty — editable);
`setRequirement(reqId, patch)` (attach a document → `providedAt = now`,
status stays PENDING until ACCEPTED/REJECTED/WAIVED are set by hand; audit
`requirement_decision`); `addRequirement`, `removeRequirement`;
`listQualifications({ status, expiringWithinDays })`. After every write:
`settlePartnerFollowUps(orgId)`.

**`document-alert-run.ts`**: `raiseDocumentAlerts(today)` for the current
version of each type and for every APPROVED qualification; owner
`PartnerSettings.vaultOwner` → ACCOUNTING default → oldest admin; vault tasks
carry no entity link (description links `/partners/vault`), qualification
tasks carry `organizationId`. `settleDocumentAlerts` after document and
qualification writes. Cron `company-document-alerts`, `56 11 * * 1-5`.

### 2.5 API

| Route | Methods | Notes |
|---|---|---|
| `/api/company-documents` | GET (`type, current=1, confidentiality`), POST multipart (`file, documentTypeKey, title, effectiveDate?, expiresAt?, confidentiality, approvedForExternal, notes?`) | list filtered by `canReadDocument`; RESTRICTED rows appear with `locked: true` and no download link for those who cannot read |
| `/api/company-documents/[id]` | GET meta (+ `usedBy`), PATCH, DELETE | |
| `/api/company-documents/[id]/file` | GET | 404 unless `canReadDocument`; `attachment`; `no-store`; rate limit 30/min/user; audit `document_view` (ip, ua) for RESTRICTED |
| `/api/company-documents/types` | GET, POST/PATCH (canAdmin) | admin-editable list |
| `/api/partners/[id]/qualifications` | GET, POST | |
| `/api/qualifications/[id]` | GET, PATCH, DELETE (admin; 409 when APPROVED) | |
| `/api/qualifications/[id]/requirements` | POST | add |
| `/api/qualifications/[id]/requirements/[rid]` | PATCH, DELETE | attach doc / decide / waive |
| `/api/qualifications` | GET (`status, derived, expiringWithinDays, owner`) | the Qualifications page |
| `/api/cron/company-document-alerts` | POST | `{ documents, qualifications, raised }` |
| `/api/admin/users/[id]` | PATCH | accepts `canViewRestrictedDocuments` **[ruling 2]** |

### 2.6 UI

- **Qualification tab** on the GC page: one card per qualification (platform,
  portal link, owner, derived status chip, dates), requirement table (type,
  required toggle, state chip, attached document version + expiry, "Attach
  current" picks the current vault document of that type, Accept / Reject /
  Waive menu, notes), coverage bar "6 of 8 satisfied", "+ Requirement",
  "Mark submitted / approved" status select. Empty: "Start a qualification".
- **`/partners/qualifications`**: table of all qualifications (GC, platform,
  derived status, submitted, expires, coverage, owner), queues Pending ·
  Info requested · Expiring 90 d · Expired; CSV.
- **`/partners/vault`**: grouped by category; per type the current version
  (title, v-number, effective → expires with a tone, confidentiality badge,
  approved-for-external check, "Used by n", Download / Preview, "New version");
  older versions collapsed; RESTRICTED rows show a lock and no action for
  users without rights. Upload dialog (type select with `items`, file picker
  snapshotting `Array.from(files)` — the 2026-10-09 lesson, dates,
  confidentiality radio with a plain-language hint, approved-for-external
  checkbox, notes).
- **Documents tab** on the GC page: the documents this GC's requirements
  reference, with their state.
- Attention rows: `qualifications-expiring` (APPROVED with `expiresAt ≤ 90 d`
  or derived EXPIRED/RENEWAL_DUE; roles OFFICE + SALES_REP), `company-docs-expiring`
  (current version expiring ≤ 30 d or expired; OFFICE). Calendar overlays
  `company_doc` (expiry, href `/partners/vault`) and `qualification_date`
  (expires / renewal, href the GC's qualification tab); icons added to
  `OVERLAY_ICON`.
- Sidebar items Qualifications, Document Vault.

### 2.7 Tests and QA

Unit: `qualification-state`, `document-alerts` (copied vendor cases + "used
by" text), `vault-access` matrix, `follow-ups` rules 3–4, coverage math.
API QA: upload INTERNAL v1 → v2 supersedes → RESTRICTED upload as MANAGER
without grant 403, with grant 201 → download as SALES_REP 404, as ADMIN 200 +
audit row → create qualification with defaults (8 rows) → attach v2 → waive
one → coverage 2/8 → status SUBMITTED → cron day 15 raises `qual-submitted`
once → APPROVED with expiry 20 days out → cron raises expiring once → delete
referenced document 409. Chromium: vault page, upload dialog, qualification
tab, qualifications list at both widths.

---

## Stage 3 — Bid invitations, decisions, submissions, outcomes, award

### 3.1 Schema

```prisma
enum BidPlatform { BUILDINGCONNECTED PROCORE PLANHUB SMARTBID CONSTRUCTCONNECT TEXTURA EMAIL OTHER }
enum BidStatus { TRACKING INVITED DECIDING ESTIMATING SUBMITTED SHORTLISTED CLOSED }
enum BidDecision { UNDECIDED BID NO_BID }
enum BidOutcome { AWARDED LOST NO_BID CANCELLED NO_DECISION REBID }
enum BidLossReason { PRICE RELATIONSHIP SCHEDULE SCOPE QUALIFICATION BONDING CAPACITY COMPETITOR UNKNOWN OTHER }
enum BidSubmissionKind { ORIGINAL REVISED ALTERNATE VALUE_ENGINEERING }
enum BidSubmissionMethod { PLATFORM EMAIL PORTAL HAND OTHER }

model BidInvitation {
  id, leadId String @unique, organizationId, contactId?, number String @unique,         // BID-00001 from bid_invitation_number_seq
  projectName String, projectType String?, scopeSummary String? @db.Text,
  invitedAt DateTime?, bidDueAt DateTime?, siteWalkAt?, preBidMeetingAt?, rfiDueAt?, addendaDeadlineAt?, interviewAt?, expectedAwardAt?,
  addendaCount Int @default(0), specsReceived Boolean @default(false),
  estimatorUserId String?, siteVisitRequired Boolean @default(false), bondRequired Boolean @default(false),
  prevailingWage Boolean @default(false), unionRequired Boolean @default(false), insuranceNotes?, scheduleNotes?,
  platform BidPlatform @default(EMAIL), platformUrl?, platformRef?,
  status BidStatus @default(INVITED), waitingOn String?,
  decision BidDecision @default(UNDECIDED), decisionScore Int?, decisionFactors Json?, decisionReason String?, decidedByUserId?, decidedAt?,
  submittedAt DateTime?, estimatingHours Decimal? @db.Decimal(6,1),
  outcome BidOutcome?, lossReason BidLossReason?, winningContractor String?, winningPrice Decimal? @db.Decimal(12,2),
  outcomeNotes String? @db.Text, outcomeAt DateTime?, awardedAmount Decimal? @db.Decimal(12,2), contractReceivedAt DateTime?,
  needsReview Boolean @default(false), signalSource String?,                                  // for Phase 5/6 intake
  createdByUserId, createdAt, updatedAt
  submissions BidSubmission[]
  @@index([organizationId, status]) @@index([bidDueAt]) @@index([status]) @@map("bid_invitations")
}
model BidSubmission {
  id, bidInvitationId, version Int, kind BidSubmissionKind, amount Decimal @db.Decimal(12,2),
  estimateId String?, roofEstimateId String?, snapshotTotalPrice Decimal?, snapshotSubtotalCost Decimal?,
  submittedAt DateTime, method BidSubmissionMethod @default(PLATFORM), recipientContactId String?,
  alternates String? @db.Text, clarifications String? @db.Text, exclusions String? @db.Text,
  fileId String?, submittedByUserId String, createdAt
  @@unique([bidInvitationId, version]) @@map("bid_submissions")
}
// PartnerSettings +: scoreWeights Json, scoreWeightsVersion Int @default(1), ourTrades String[] (ServiceCategory ids), homeCounties String[], adjacentCounties String[], typicalRange Json ({ [tradeId]: {min,max} }), bondingCapacity Decimal?
```
Hand SQL:
```sql
CREATE SEQUENCE IF NOT EXISTS bid_invitation_number_seq START 1;
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_outcome_closed_chk" CHECK (outcome IS NULL OR status = 'CLOSED');
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_awarded_amount_chk" CHECK (awarded_amount IS NULL OR outcome = 'AWARDED');
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_score_chk" CHECK (decision_score IS NULL OR decision_score BETWEEN 0 AND 100);
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submission_one_source_chk" CHECK (num_nonnulls(estimate_id, roof_estimate_id) <= 1);
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submission_version_chk" CHECK (version >= 1);
```

### 3.2 Pure modules

**`bid-state.ts`**
```ts
export const BID_TRANSITIONS: Record<BidStatus, readonly BidStatus[]>
//  TRACKING → INVITED, CLOSED · INVITED → DECIDING, ESTIMATING, CLOSED · DECIDING → ESTIMATING, CLOSED · ESTIMATING → SUBMITTED, DECIDING, CLOSED
//  SUBMITTED → SHORTLISTED, ESTIMATING (revision), CLOSED · SHORTLISTED → SUBMITTED, CLOSED · CLOSED → INVITED (reopen, admin)
export function canTransition(from, to): boolean
export function closeRequires(outcome): { lossReason: boolean; awardedAmount: boolean }   // LOST needs a reason; AWARDED needs an amount
export function leadStageFor(outcome: BidOutcome | null): "won" | "lost" | "open"            // only Won/Lost are mirrored
export function bidNumber(n: number): string   // BID-00001
```
Tests: the full transition matrix; NO_BID outcome requires `decision = NO_BID`
or sets it; CLOSED without outcome rejected.

**`bid-score.ts`** — weights schema (zod) + `DEFAULT_BID_WEIGHTS` + scorer.
```ts
export type BidScoreInput = {
  healthScore: number | null;            // Stage 4; null → neutral 7.5
  estimatedValue: number | null; typicalRange: { min: number; max: number } | null;
  packageTradeIds: string[]; ourTradeIds: string[];
  county: string | null; homeCounties: string[]; adjacentCounties: string[];
  daysToDue: number | null;
  avgDaysToPay: number | null;
  decidedSubmissions: number; awards: number;
  insuranceCurrent: boolean | null;      // Stage 2 coverage of the GC's requirements
  bondRequired: boolean; bondingCapacity: number | null;
  manual: { margin: 1|2|3|4|5|null; capacity; competition; complexity; plansAndTerms };
};
export type BidScore = { score: number; recommendation: "BID" | "REVIEW" | "NO_BID"; reasons: string[]; concerns: string[]; breakdown: Record<string, { points: number; max: number; note: string }>; gates: string[]; weightsVersion: number };
export function scoreBid(input: BidScoreInput, weights: BidWeights, weightsVersion: number): BidScore
```
Rules exactly as the plan's §12 table; unknown inputs score the declared
neutral and add a concern; gates: no trade fit → NO_BID; bond required with
no capacity → cap at REVIEW; `score` clamped 0–100.
Tests: the worked example (75 → BID); every gate; every null → neutral; manual
slider null → 0 points and a concern "not rated"; weights override.

**`scorecard.ts`** (Stage 3 ships counts; Stage 4 adds money)
```ts
export function bidKpis(rows: BidRowForKpi[], window: { from: Date; to: Date }): { invitations; decided; bid; noBid; submitted; awarded; lost; open; bidRate; winRateOutcome; winRateCohort; openValue; avgTurnaroundDays; lossReasons: Record<string, number> }
```

### 3.3 Services

**`bids.ts`**
```ts
export async function createBid(orgId, input, actor): Promise<BidDetail>
```
One transaction: `number = nextval` (`BID-nnnnn`); Lead insert via Prisma
(`kind GC_BID`, names/phone from the contact or org (`"N/A"` fallback),
`companyName = org.name`, site address from input, `propertyType COMMERCIAL`,
`sourceId` = "GC bid invitation", `currentStageId` = "New Lead",
`assignedUserId = input.estimatorUserId ?? org.ownerUserId ?? actor`,
`estimatedJobValue = input.estimatedContractValue`, `organizationId`,
`contactId`, `createdByUserId = actor`); `LeadService` rows for
`input.tradeIds`; `BidInvitation` insert; `ActivityLog LEAD_CREATED`; audit
`bid_create`; interaction `BID_DISCUSSION` INBOUND "Invitation received" when
`status = INVITED` (so rule 4 settles and `lastContactAt` moves).
`updateBid` (header fields; audit `update`); `setStatus(id, status, actor)`
(`canTransition` else 409; `waitingOn` cleared on leaving ESTIMATING; SUBMITTED
requires ≥1 submission; stamps `submittedAt`; CLOSED requires `closeBid`);
`decide(id, { decision, manual, reason }, actor)` (canAdminPartners; computes
`scoreBid` from loaded inputs, stores `decisionScore/Factors/Reason/decidedBy/At`;
NO_BID → `closeBid(outcome NO_BID)`; BID → status ESTIMATING; audit
`bid_decision`); `previewScore(id, manual)` (GET, writes nothing);
`closeBid(id, { outcome, lossReason?, winningContractor?, winningPrice?, outcomeNotes?, awardedAmount? }, actor)`
(validates `closeRequires`; status CLOSED, `outcomeAt`; LOST/NO_BID/CANCELLED
→ lead to the `isLost` stage through a shared `moveLeadStage(leadId, stageId,
actor, reason)` helper extracted from the stage route (history + activity +
audit, **no** `emitLeadEvent` for `GC_BID`); AWARDED → `awardBid`); `awardBid`
(`lead.estimatedJobValue = awardedAmount`; `moveLeadStage` to the `isWon`
stage; `createJobFromLead(leadId, actor, { billingMethod: "PROGRESS",
retainagePercent: 10, depositRequired: 0, skipDepositTask: true, title:
"<trade> — <projectName>" })`; audit `bid_award` with the job id; returns
`{ bid, job }`); `reopenBid` (admin; outcome cleared; lead to the first open
stage by `stageOrder`; a job already created is left alone with a 409 unless
`force`); `listBids(params)` (status, org, estimator, due window, outcome,
scope); `getBidDetail(id)` (invitation + lead label + org + contact +
submissions + estimates summary + files count + open tasks + score snapshot +
permissions).

**`src/lib/services/jobs.ts`**: `createJobFromLead(leadId, userId, opts?: { billingMethod?; retainagePercent?; depositRequired?; skipDepositTask?; title? })`;
when `opts` is absent and `lead.kind === "GC_BID"` the GC defaults apply;
`depositRequired` default stays 50% for customers. The deposit task is created
only when `!skipDepositTask && depositRequired > 0 && no workflow`.

**`src/app/api/leads/[id]/stage/route.ts`**: 409 `{ error: "This lead is a
bid; change the bid status instead", hint: "/leads/<id>?tab=bid" }` when
`lead.kind === "GC_BID"`; the shared `moveLeadStage` helper is what both the
route and `bids.ts` call.

**`submissions.ts`**: `addSubmission(bidId, input, actor)` — `version = max+1`;
snapshot `totalPrice/subtotalCost` from the linked estimate; optional file
(a `File` on the lead, category ESTIMATE) uploaded through the same multipart
handler; first submission moves status → SUBMITTED when ESTIMATING; audit
`bid_submitted` / `bid_revised`. Never updated or deleted (admin DELETE only
within 24 h, audited).

### 3.4 API

| Route | Methods | Body |
|---|---|---|
| `/api/bids` | GET (`status, organizationId, estimator, dueFrom, dueTo, outcome, scope, view=board`) · POST (`createBidSchema`: organizationId, contactId?, projectName, projectType?, scopeSummary?, site { address1, address2?, city, state?, zipCode }, county?, tradeIds (≥1), estimatedContractValue?, estimatorUserId?, dates…, flags…, platform, platformUrl?, platformRef?, status TRACKING\|INVITED) | `{ rows, canManage }` / 201 `BidDetail` |
| `/api/bids/[id]` | GET · PATCH (`updateBidSchema`) · DELETE (admin; only TRACKING/INVITED with no submissions; deletes the lead too) | |
| `/api/bids/[id]/status` | POST `{ status, waitingOn? }` | 409 on an illegal transition |
| `/api/bids/[id]/decision` | GET `?margin=&capacity=&competition=&complexity=&plansAndTerms=` (preview) · POST `{ decision, manual, reason? }` | `BidScore` / `BidDetail` |
| `/api/bids/[id]/outcome` | POST `{ outcome, lossReason?, winningContractor?, winningPrice?, outcomeNotes?, awardedAmount? }` | `{ bid, job? }` |
| `/api/bids/[id]/reopen` | POST (admin) `{ force? }` | |
| `/api/bids/[id]/submissions` | GET · POST multipart or JSON (`version` ignored, `kind, amount, estimateId?/roofEstimateId?, submittedAt, method, recipientContactId?, alternates?, clarifications?, exclusions?, estimatingHours?` (patches the invitation), file?) | 201 submission |
| `/api/bids/[id]/estimating-hours` | POST `{ hours }` | |
| `/api/leads/[id]` | GET includes `bidInvitation { … }`, `organization { id, name }` for `GC_BID` | |
| `/api/calendar` | adds `bid_date` overlays: due (danger tone), site walk, pre-bid, RFI, addenda, interview, expected award; scoped by `leadAccessWhere`; `?kinds=bid_date` filter honoured | |
| `/api/attention` | rows `bids-due` (open, `bidDueAt ≤ +7 d` or past, not SUBMITTED/CLOSED; roles OFFICE + SALES_REP), `bids-awaiting-decision` (INVITED/DECIDING older than 2 working days; ADMIN/MANAGER) | |

### 3.5 UI

- **Lead page**: for `GC_BID` leads the tab list is `bid, estimates, takeoff,
  files, tasks, comms, activity, history` with **bid** default; header shows a
  `Callout` "Bid BID-00012 for Coastal Choice · due Thu Oct 23, 2:00 pm · 9
  days"; the lead `StageStepper` is replaced by the bid status stepper.
- **`src/components/partners/bid-panel.tsx`**: header facts grid (GC → link,
  contact, project, type, trades, site, platform link, estimator, flags as
  chips), dates list (each with "Add to my calendar" = the overlay already
  shows it; "Edit"), decision card (score preview with the five sliders,
  reasons / concerns, Decide: Bid / No-bid with reason; the stored decision
  shown read-only afterwards with "Re-score" for admins), submissions table
  (version, kind, amount, margin from snapshot, submitted, method, recipient,
  file link) + "Record submission" dialog, estimating hours inline number,
  outcome card ("Close bid…" dialog: outcome radio, loss reason select,
  competitor + winning price, notes; AWARDED asks for the award amount and
  shows "This creates job <trade> — <project> with progress billing and 10%
  retainage"), after award a `JobRef` to the job.
- **`/partners/bids`**: list (Number, GC, Project, Trade, Due (tone), Status,
  Estimator, Value, Decision, Outcome) with queues Due this week · Awaiting
  decision · Estimating · Submitted · Closed; board by `BidStatus` (`?view=board`,
  columns from a `BID_STAGES` const through `buildStageToneMap`; drag →
  `/status`; CLOSED column accepts no drops — closing is the dialog). "+ New
  bid" opens `bid-form-dialog` (GC picker searching `/api/partners`, contact
  select from the GC, site address with `address-autofill-fields`, trades
  multi-select, dates, platform, estimator).
- **GC page**: Bids tab (the GC's invitations, same columns), Projects tab
  (jobs through `lead.organizationId`, `JobRef`, contract amount, stage,
  cost-summary margin when `canViewMoney`), Overview gains open bids count +
  next due.
- **Bid Calendar** sidebar item → `/calendar?kinds=bid_date`; the calendar's
  Viewing filter gets a Kinds menu (tasks / overlays per kind) if not present.
- **Dashboard**: the two rows appear in Needs attention automatically.

### 3.6 Tests and QA

Unit: `bid-state` (matrix), `bid-score` (example, gates, neutrals, weights
version), `scorecard` counts, `createJobFromLead` options (mock Prisma or the
pure default-picker extracted as `jobDefaultsFor(lead, opts)`), `bidNumber`,
`leads/query` (bid hits), `calendar/overlays` (`bid_date` rows).
API QA: create bid (lead created with `kind GC_BID`, `BID-00001`, source,
services) → appears in `/api/bids` and `/api/leads?kind=GC_BID`, not in
`/api/leads` → lead stage route 409 → decision preview with sliders → decide
BID (status ESTIMATING, score stored) → add estimate on the lead → record
submission v1 with the estimate (status SUBMITTED, margin snapshot) → v2
REVISED → close LOST without reason 400, with PRICE 200 (lead stage Lost; no
`FollowUpExecution` rows; nurture dry run untouched) → reopen (admin) → close
AWARDED 832,500 → job created with PROGRESS / 10 / deposit 0 / no deposit task
/ workflow applied / title "Drywall — Towne Place Suites" → `/api/calendar`
shows the due date overlay → attention `bids-due` count = list. SALES_REP:
create bid 201, decide 403, outcome 201 (record outcome allowed), award 403.
Chromium: bid tab at 1280/400, decision sliders live score, submission dialog
with a file through the real picker, close dialog, bids board drag, calendar
week with the dashed bid card.

Backfill extension: `scripts/backfill-partners-coastal-choice.ts --bid`
creates the CLOSED/AWARDED invitation for JOB-00009 (`invitedAt` unknown →
null, `outcomeAt 2025-03-07`, `awardedAmount 832500`, `estimatorUserId` =
Richard) and one ORIGINAL submission (`amount 830000`, note "approximate,
backfilled"); idempotent on `leadId`.

---

## Stage 4 — Health score, scorecard, analytics

### 4.1 Schema
`PartnerSettings +: healthWeights Json, healthWeightsVersion Int @default(1), preferredMinAwards Int @default(2), preferredMinMargin Decimal @default(0.20)`. No new tables. `DashboardMetricSnapshot` (exists, unused) may receive a nightly `partner.health.<orgId>` row for trend lines — optional, Stage 4b.

### 4.2 Pure modules
**`health.ts`**: `healthWeightsSchema` + `DEFAULT_HEALTH_WEIGHTS` (the plan's
§17 tables), `scoreHealth(input: HealthInput, w, version, now): HealthResult`
with `{ score, band, breakdown, strengths, weaknesses, recommendedAction, weightsVersion }`;
dormant cap; action table. Tests: the Coastal Choice example (76 Active),
the 200-day cap (40), every band boundary, null economics, config override.
**`windows.ts`**: `windowFor(preset, today, from?, to?)` on `weekRange` /
`monthRange` (quarter = calendar quarter, year = calendar year; `custom`
requires both dates). Tests across DST and year boundaries.
**`scorecard.ts`** (extended): money KPIs from `JobCostRow[]`, invoices and
payments: revenue, GP, margin, average contract, days-to-pay with the unlinked
count, change-order approval rate, GP per estimating hour (both variants),
repeat work, relationship activity; `groupBy(rows, key)` for org / trade /
market / owner.
**`derive.ts`**: `preferred` badge uses the settings thresholds.

### 4.3 Loaders and API
`scorecard-load.ts`: `loadOrgScorecard(orgId, window)` (bids, submissions,
interactions, qualification, `getJobCostRows({ lead: { organizationId: orgId } })`,
invoices + payments of those jobs), `loadAnalytics(window, groupBy, filters)`
(all orgs, batched), `loadHealthInputs(orgIds)` (used by the list page and the
bid score). `GET /api/partners/[id]/scorecard?preset=&from=&to=` →
`{ window, kpis, health, trend?: [] }`; `GET /api/partners/analytics?preset=&groupBy=org|trade|market|owner&stage=&market=` →
`{ window, totals, groups: [{ key, label, kpis }], pipeline: { byStage }, bdKpis: { newOrgs, contactsAdded, outreach, responses, meetings, qualsStarted, qualsSubmitted, qualsApproved, invitations, submitted, awards, awardedRevenue, awardedGp } }`;
roles `canViewMoney` (ADMIN, MANAGER, OFFICE_STAFF, READ_ONLY); `?csv=1`
returns `text/csv` of the groups.

### 4.4 UI
- GC page header: health pill (score + band, tooltip with the top strength /
  weakness); **Performance tab**: the scorecard KPIs as `KpiCard`s, the health
  breakdown bars, strengths / weaknesses / recommended action (with "Create
  task" turning the action into a task on the org), window presets.
- `/partners` list: Health column (sortable), default sort by health desc when
  the preset is on.
- `/partners/analytics`: preset buttons + custom dates; KPI row; recharts bar
  charts (revenue / GP / win rate by GC; by trade; by market); pipeline strip
  (orgs by stage, each a link to the filtered list); BD KPIs table by
  week/month/quarter/year (`groupBy=period`); CSV. Charts render only with
  ≥1 group; otherwise an `EmptyState` naming what is missing.
- `/admin/partners`: Weights tab (health and bid weights as editable JSON with
  schema validation and a "Reset to defaults" button; saving bumps the version
  and the audit records before/after).
- Dashboard: an optional "Business Development" KPI strip (open bid value,
  bids due this week, overdue partner follow-ups) for ADMIN/MANAGER, below
  Needs attention.

### 4.5 Tests and QA
Unit: `health` (≈15 cases), `windows` (≈8), `scorecard` money (≈12 incl.
unlinked payments excluded and reported). API QA: scorecard on the backfilled
Coastal Choice (revenue from its invoices, days-to-pay from its payments,
health computed), analytics by trade = one Drywall group, CSV header row,
SALES_REP 403 on analytics, READ_ONLY 200. Chromium: Performance tab and
analytics at both widths; charts absent with no data.

---

## Appendix A — Catalogues

**Audit actions** (`entityType` → actions): Organization → create, update,
delete, stage_change, owner_change · Contact → create, update, deactivate ·
Interaction → create, update, delete · PartnerSettings → update ·
CompanyDocumentType → create, update · CompanyDocument → document_upload,
update, confidentiality_change, approved_for_external, delete, document_view ·
Qualification → create, qualification_status, update, delete ·
QualificationRequirement → requirement_decision, create, delete · BidInvitation
→ bid_create, update, bid_status, bid_decision, bid_outcome, bid_award,
bid_reopen, delete · BidSubmission → bid_submitted, bid_revised, delete.

**sourceKey families**: `org:<id>:followup:<rule>@<anchor>#<period>` ·
`org:<id>:qual:<qid>:<expiring|expired|renewal>@<day>` ·
`company-doc:<docId>:<expiring|expired>@<day>`.

**Calendar kinds added**: `company_doc`, `qualification_date` (Stage 2),
`bid_date` (Stage 3). **Attention rows added**: `partner-follow-ups` (Stage 1:
open follow-up tasks past due, roles OFFICE + SALES_REP), `qualifications-expiring`,
`company-docs-expiring` (Stage 2), `bids-due`, `bids-awaiting-decision` (Stage 3).
**Search hit types added**: `organization`, `contact` (Stage 1); lead hits
relabelled for bids (Stage 1), numbered (Stage 3).

**Cron wrappers**: `partner-follow-ups.sh` `55 11 * * 1-5`,
`company-document-alerts.sh` `56 11 * * 1-5`.

**Env**: none new in Stages 1–4.

## Appendix B — Rulings the specification assumes

1. Six-value `PartnerStage` enum + derived badges (§1.3).
2. SALES_REP in `PARTNER_MANAGE_ROLES`; RESTRICTED documents readable by ADMIN
   always and by MANAGER / OFFICE_STAFF holding `canViewRestrictedDocuments`
   (§1.3, §2.1, §2.3). If Richard prefers ADMIN/MANAGER only, drop the User
   column and the grant check; nothing else changes.
3. Bid-as-Lead consequences (§3.3): hidden from Leads by default, no nurture
   or rule mail, one job per package with PROGRESS / 10% / no deposit on award,
   lead stage mirrors Won/Lost only.
4. JOB-00009's `billingMethod` is patched only under `--fix-billing` after
   Richard reads the printed values (§1.9).
