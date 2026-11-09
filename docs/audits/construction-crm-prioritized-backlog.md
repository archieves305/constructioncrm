# Prioritized backlog — KNU Construction CRM (web)

Checkpoint 3, 2026-11-09. One list combining the defects, workflow changes, accessibility, design-system work and technical debt found in the audit. Each line is a ticket in [implementation tickets](construction-crm-implementation-tickets.md).

**Scoring** — each criterion 1–5, weighted as the brief set: business impact 25 %, workflow frequency 20 %, user-experience improvement 20 %, reliability 15 %, implementation efficiency 10 % (5 = cheapest), reusability 10 %. Score = weighted sum × 20 (0–100). **Security and data-integrity items rank first regardless of score.** Frequency follows the Nov 8 production usage: tasks (reassign, re-date), notes, crew payments and expenses dominate.

**Effort** — S ≤ ½ day · M 1–2 days · L 3–5 days · XL 1–2 weeks — one engineer (or one Claude Code session-day) including tests and dev QA; counted as 0.5 / 1.5 / 4 / 8 days.

| Rank | Ticket | Title | Category | Phase | Score | B | F | U | R | E | Re | Effort | Quick win |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | T-01 | Validate the job-permit create body with a schema — *override: Data integrity: values stored as sent* | Data integrity | A | 53 | 3 | 2 | 1 | 4 | 5 | 2 | S | yes |
| 2 | T-02 | One query-state wrapper: loading, refused, not found, failed | Functional defect | A | 83 | 4 | 4 | 4 | 5 | 3 | 5 | L |  |
| 3 | T-06 | A task made from a "mine" view is assigned to its maker | Workflow defect | A | 81 | 4 | 5 | 4 | 3 | 5 | 3 | S | yes |
| 4 | T-15 | DataTable: sortable, filterable lists on the table component | Design system | B | 76 | 4 | 5 | 4 | 2 | 2 | 5 | XL |  |
| 5 | T-18 | Task sheet: Done / Undo button; read-only values on phone rows | Workflow | C | 76 | 4 | 5 | 4 | 2 | 4 | 3 | M |  |
| 6 | T-09 | Apply the Geist font (fix the self-referencing `--font-sans`) | Design system | B | 74 | 3 | 5 | 4 | 1 | 5 | 5 | S | yes |
| 7 | T-05 | Pass `items` to every id-valued Select; render enum values by label | Functional defect | A | 70 | 3 | 3 | 4 | 3 | 5 | 4 | M | yes |
| 8 | T-11 | Button hierarchy: one primary, named icon buttons, loading state | Design system | B | 69 | 3 | 4 | 4 | 2 | 3 | 5 | L |  |
| 9 | T-07 | Show the field's own message when validation fails | Functional defect | A | 68 | 3 | 3 | 3 | 3 | 5 | 5 | S | yes |
| 10 | T-10 | Typography scale and status colour tokens; migrate raw palette classes | Design system | B | 67 | 3 | 4 | 4 | 2 | 2 | 5 | XL |  |
| 11 | T-17 | Touch targets ≥ 44 px on phones | Accessibility | B | 67 | 3 | 4 | 3 | 2 | 4 | 5 | S | yes |
| 12 | T-19 | Dashboard: act-first layout | UI/UX | C | 67 | 4 | 5 | 3 | 1 | 4 | 2 | M |  |
| 13 | T-21 | Searchable pickers where people type record names | Forms | D | 66 | 3 | 3 | 4 | 3 | 3 | 4 | L |  |
| 14 | T-14 | StatusBadge: one way to show a status, with label and tone | Design system | B | 65 | 3 | 4 | 3 | 2 | 3 | 5 | M |  |
| 15 | T-08 | Hide what a role can't do: write buttons, nav entries, the owner strip call | Permissions UX | A | 64 | 3 | 3 | 3 | 3 | 4 | 4 | M |  |
| 16 | T-27 | Regression suite in the repo: smoke, workflows, axe, refusals | Quality | F | 63 | 4 | 2 | 1 | 5 | 3 | 5 | L |  |
| 17 | T-03 | Convert the remaining raw `fetch().then(r => r.json())` reads to `fetchJson` | Technical debt | A | 61 | 3 | 3 | 2 | 4 | 3 | 4 | M |  |
| 18 | T-04 | Plan-sheet render answers 410 when the source PDF is missing | Functional defect | A | 61 | 3 | 2 | 3 | 4 | 5 | 2 | S | yes |
| 19 | T-12 | Labels tied to fields; named Select triggers | Accessibility | B | 60 | 2 | 4 | 3 | 2 | 3 | 5 | L |  |
| 20 | T-26 | Saved filters and search on the main lists | Usability | E | 58 | 3 | 4 | 3 | 1 | 2 | 4 | L |  |
| 21 | T-16 | PageHeader on the remaining 33 pages; dialog and sheet sizes | Design system | B | 57 | 2 | 4 | 3 | 1 | 4 | 4 | M |  |
| 22 | T-20 | New Lead: check required fields in the browser; close address suggestions on blur | Workflow | C | 57 | 3 | 3 | 3 | 2 | 4 | 2 | S | yes |
| 23 | T-13 | Replace native confirm() / prompt() with ConfirmDialog | Design system | B | 56 | 2 | 3 | 3 | 2 | 4 | 4 | M |  |
| 24 | T-23 | Refusals say who may do it | UI/UX | D | 54 | 2 | 2 | 3 | 2 | 5 | 4 | S | yes |
| 25 | T-25 | Money in one place: crew payments reachable from Money | Navigation | D | 54 | 3 | 3 | 3 | 1 | 4 | 2 | S | yes |
| 26 | T-22 | Permit page: type label in the title, scrollable tabs | UI/UX | D | 53 | 2 | 3 | 3 | 1 | 5 | 3 | S | yes |
| 27 | T-24 | Admin screens: row action menus and named controls | UI/UX | D | 41 | 2 | 1 | 3 | 1 | 3 | 3 | M |  |

## Quick wins

11 tickets, each S or M, none needing a design decision; about 6.5 engineer-days together:

- **T-06** A task made from a "mine" view is assigned to its maker (S, score 81; D-12)
- **T-09** Apply the Geist font (fix the self-referencing `--font-sans`) (S, score 74; D-14)
- **T-05** Pass `items` to every id-valued Select; render enum values by label (M, score 70; D-06)
- **T-07** Show the field's own message when validation fails (S, score 68; D-13, D-08)
- **T-17** Touch targets ≥ 44 px on phones (S, score 67; UI audit (31 / 54 small controls), axe target-size)
- **T-04** Plan-sheet render answers 410 when the source PDF is missing (S, score 61; D-02)
- **T-20** New Lead: check required fields in the browser; close address suggestions on blur (S, score 57; workflow analysis §3)
- **T-23** Refusals say who may do it (S, score 54; workflow analysis)
- **T-25** Money in one place: crew payments reachable from Money (S, score 54; workflow analysis §4)
- **T-01** Validate the job-permit create body with a schema (S, score 53; code-inspected)
- **T-22** Permit page: type label in the title, scrollable tabs (S, score 53; D-09)

## Effort by phase

| Phase | Tickets | Engineer-days |
|---|---:|---:|
| A | 8 | 10.5 |
| B | 9 | 29.5 |
| C | 3 | 3.5 |
| D | 5 | 7 |
| E | 1 | 4 |
| F | 1 | 4 |
| **Total** | **27** | **58.5** |

Add about 25 % for QA, click-throughs and deploys between phases (the house pattern: dev QA, Richard's click-through, deploy, then the next phase): **≈ 73 engineer-days**, about 15 working weeks for one engineer. Phase C/D screen redesigns beyond the tickets listed (for example a rebuilt job page) are not in this figure; they need the design-system proposal approved first.

## Grouping

Changes that touch the same components are grouped so each is opened once: T-09 → T-10 → T-14 (tokens, then everything that renders colour), T-11 → T-12 → T-21 (buttons, then fields, then pickers), T-02 → T-03 → T-08 (query states, then the fetch sweep, then role-aware UI), T-15 → T-24 / T-26 (DataTable, then the screens on it).
