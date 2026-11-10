# C — User roles and permission matrix

**Ruling (Richard, 2026-11-09):** build first for KNU's W2 employees, with CareyOS logins. Subcontractor crews keep the guest links.

## Roles

| Role | Who | Exists? | Login |
|---|---|---|---|
| Office admin (ADMIN / MANAGER / OFFICE_STAFF) | the office | yes | CareyOS |
| Project manager | `Job.projectManagerId` on any office role | yes | CareyOS |
| Foreman / supervisor | `CREW_LEAD` | yes, 1 user | CareyOS |
| **Crew member** | a W2 worker | **new `CREW_MEMBER`** | CareyOS, granted in the portal, linked by `Personnel.userId` |
| Subcontractor crew | a 1099 crew or vendor | no login (ruling) | guest link |
| Temporary / external | anyone else | no login | guest link |

**Why a new role rather than reusing CREW_LEAD:** a CREW_LEAD can create tasks for others, create personnel, write the whole crew sheet and the daily log, and complete workflow steps (`lib/labor/roles.ts`, `lib/workflows/access.ts:70`). A crew member should do none of these.

## One "on the job" rule (fixes gap 2)

Today `guardJob` uses `jobsInvolvingUserWhere` (`lib/jobs/involvement.ts`), while `requireJobFieldAccess` and `/api/field/today` accept only a `JobFieldAssignment` or PM (`lib/labor/permissions.ts:85–126`). A crew lead can therefore open a job's files but is refused its logs.

**Proposal:** `crewJobIds(user)`, a new function in `lib/access/crew.ts`, defines "on the job" for the crew roles, and every guard uses it for them. A person is on a job when any of these holds:
1. there is a `JobFieldAssignment` for them;
2. their `Personnel.crewId` has a `CrewAssignment` on the job;
3. they hold a workflow team slot on the job, or are its PM.

## Matrix

**R** read · **W** write · **own** only their own records · **—** refused by the server. Each row names the guard that enforces it: **today** where it already exists, **new** where it has to be built.

| Action / data | Office | PM (own jobs) | Foreman | Crew member | Guard |
|---|---|---|---|---|---|
| See assigned jobs (address, scope, start) | R | R | R (on job) | R (on job) | today `guardJob`; new crew rule |
| Customer name | R | R | R | **street only** | new crew projection on job reads |
| Customer phone / email | R | R | **—** (gap 3) | **—** | new; strip `contactOf` for crew roles |
| Tasks: view | all | job | job + own | **own + crew's on that job** | `lib/tasks/access.ts` + new crew case |
| Tasks: complete / block / note | W | W | W (job) | **own** | `canEditTask` + crew case |
| Tasks: create for others | W | W | W | **—** | `canCreateTasks` (exclude CREW_MEMBER) |
| Photos / videos: add | W | W | W | W (on job) | `/api/files` + crew rule |
| Documents: read | all | all | **allowlist** | **allowlist** | new category allowlist (gap 1) |
| Plans (plan sheets) | R | R | R | R | new job-scoped sheet route |
| Daily log: write / submit | W | W | W | **—** (contributes notes and photos) | `requireJobFieldAccess` |
| Daily log: approve | W | W | — | — | today `canModerate` |
| Crew hours: whole sheet | W | W | W | **—** | `requireJobFieldAccess` |
| Clock self in / out | — | — | W | **W own entry only** | new `/api/me/clock` |
| Report issue / safety | W | W | W | W (on job) | `field-issues` POST + crew rule |
| Material request | W | W | W | W (request only; never buys) | same |
| Inspections | W | W | R | R | today `guardProductionWrite` (writes) |
| Schedule: change official dates | W | W | — | — | `canDispatch` |
| Acknowledge an assignment | — | — | W | W own | new |
| Money (contract, costs, pay, margins) | per `jobMoneyView` | full | none | **none** | `jobMoneyView` returns "none" |
| Payroll, rates, SSN, other workers' details | per grants | — | roster names only | **own name only** | `canViewPayroll`, `canViewSensitivePersonnel` |
| Admin settings, other jobs | W | — | — | — | role lists |

## Security notes

- **Server-enforced, not hidden menus:** every row above is a route guard. The contract test `route-guards.test.ts` gains the crew roles.
- **Removing someone:** ending a worker means deactivating the CRM user and removing the portal grant. Both take effect on the next request, because `getSession` introspects every time. The phone's bearer token is revoked from Admin → Phones. The cache is wiped at sign-out, not remotely; that is a gap, covered in J.
- **Assignment changes** take effect on the next request, because the crew rule is read live and never cached in the token.
- **Company isolation:** the CRM is single-company (KNU). The portal grant is per app, so a CareyOS account without a CRM grant gets nothing.
