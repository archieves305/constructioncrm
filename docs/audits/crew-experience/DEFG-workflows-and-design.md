# D–G: crew workflows, crew vs office features, navigation and screens

## D. Crew workflow analysis

What a W2 worker's day needs, and where each part comes from today:

| Moment | What they need | Source today | Gap |
|---|---|---|---|
| Night before / morning | Where am I tomorrow / today, what time, who is my foreman | `CrewAssignment.installDate`, `Task.scheduledStart`, the my_day push | Per-crew schedule; a start time per assignment |
| Arriving | Directions, gate code or access notes | job address; access notes are in free text (A) | A field for site-access notes on the job |
| Start | Clock in | Foreman's crew sheet | Self clock-in |
| During | The task list for the job; plans; photos | tasks, files, photos | Allowlisted docs; crew task list per job |
| Problem | Report it with a photo; call the foreman | field issues, phone call | Wire "call foreman" (needs a foreman user or phone) |
| Material short | Ask for it | MATERIAL_REQUEST → Purchasing | — |
| End | Mark tasks done; after photos; clock out | tasks, photos | Self clock-out |
| After | The foreman's daily log rolls up hours, photos and issues | daily log | Show crew-member entries in the foreman's log |

**Office side, unchanged:**
- The PM assigns a crew to a job (`CrewAssignment`) or a person to it (`JobFieldAssignment`).
- The office makes tasks.
- Field changes flow back through the same tables, so there is no second source of truth.

## E. Crew vs office features

| Feature | Office | Foreman (CREW_LEAD) | Crew member |
|---|---|---|---|
| Jobs list, money, estimates, contracts | ✓ | jobs only, no money | today's and the week's jobs only |
| Tasks | all | job and own | own (plus the crew's on that job, read) |
| Create a task for someone | ✓ | ✓ | — (report an issue instead) |
| Daily log, crew sheet | ✓ | ✓ | contribute photos and notes; own clock |
| Photos, video | ✓ | ✓ | ✓ |
| Issues, punch, materials | ✓ | ✓ | ✓ |
| Plans and allowlisted docs | ✓ | ✓ | ✓ |
| Inspections | ✓ | read | read (date and result) |
| Approvals, crew links, payments, owner view, leads, expenses | office | — | — |
| Schedule edits | ✓ | — | — (acknowledge only) |

## F. Navigation

The crew member gets four tabs in KNU Field. The office and foreman tabs stay as they are:

**Today · Jobs · Add (+) · Me**

- **Today:** the job(s) for the day, and the actions on them.
- **Jobs:** this week, by day.
- **+:** Photo, Problem, Materials.
- **Me:** language, notifications, help, sign out.

There is no Tasks tab. A crew member's tasks sit inside the job, so they never browse a task list outside the job they're on.

**Language:** English or Spanish. It defaults from `Crew.language` or a new `User.locale`, and can be changed under Me.

## G. Screens (crew member), at phone width

### 1. Today (home)
```
Good morning, [worker]                 Mon, Nov 9
┌────────────────────────────────────────┐
│ [job street address]                    │
│ Start 7:30 · Foreman: [name]    [Call]  │
│ Drywall hang — 2nd floor                │
│ [ Directions ]   [ Clock in ]           │
└────────────────────────────────────────┘
Today's work (3)                 ▸ open job
 ○ Hang 2nd-floor bedrooms
 ○ Patch stair wall           High
 ✓ Unload board
Needs you: 1 issue answered
[ 📷 Photo ] [ ⚠ Problem ] [ 📦 Materials ]
```
- No job today: "No job today", followed by the next assignment.
- Two jobs: one card each.

### 2. Job (today's job)
- Address and directions; access notes; the foreman with a Call button.
- Today's tasks (Done / Undo).
- Plans: the sheets only.
- Documents: the allowlist.
- This job's photos, newest first.
- Open issues on this job.

### 3. Task detail
Title, details, checklist ticks, a Photo button, Done / Blocked. No dates, owner or priority controls.

### 4. Week
Seven days, one row per assignment: date, street and start time. Each row has an "OK" (acknowledge) button.

### 5. Photo
- Opens the camera at once.
- Up to 10 photos per send, then: Before / During / After (one tap), an optional task and an optional note.
- Send queues them, and they upload by themselves.

### 6. Daily report
Foreman only, the existing log. The crew member's photos and notes appear in the foreman's draft.

### 7. Materials
Item (picked from the job's past requests, or typed), quantity, a photo, "needed by". Status shows: requested → ordered → delivered.

### 8. Report a problem
- Category chips: missing material, equipment, site access, safety, blocked, unexpected condition, quality, other.
- Then a photo, a short note (or dictation), and Urgent (yes / no).
- **Safety** first shows "If anyone is hurt or in danger, call 911 now" and a Call foreman button, then files.

### 9. Documents
The allowlist only: plans, permit card, inspection results, photos, videos and install details. A note marks superseded plans ("Newer version available").

### 10. Messages
- MVP: Call or Text the foreman from the job screen.
- A job thread comes in Release 3.

### 11. Me
Name, language (English / Español), notifications, "Help: how to use KNU Field" (a short card), sign out.

**Design rules:**
- Shared tokens (`mobile/src/ui/tokens.ts`).
- Touch targets of 48 pt or more.
- Photo-first.
- Never a free-text field without dictation.
- A confirmation after every send: "Sent ✓" or "Waiting for signal".
