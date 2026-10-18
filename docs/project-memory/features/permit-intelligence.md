# Permit Intelligence

Plan approved 2026-10-18 (`~/.claude/plans/reactive-tickling-pony.md`); full
design in `CAREYOS_PERMIT_INTELLIGENCE_DESIGN.md` (repo root). Stages 0–6:
shared AI layer → permit record → corrections → form filling → product
approvals → preflight → knowledge + metrics. Each stage is built, QA'd,
deployed and clicked through before the next.

Prod on 2026-10-18: 3 permits (Boynton Beach, City of Miami, "City of Palm
Beach"), 0 inspections, 27 jobs. `ANTHROPIC_API_KEY` was placed in
`/etc/knuco/env` the same day (a call from the droplet answered 200).

## Stage 0 — shared AI layer (built 2026-10-18 on `permit-ai-foundation`)

- `src/lib/ai/`
  - `client.ts`: `isAiConfigured`, `aiClient` (120 s, 2 retries), `defaultModel` (`AI_MODEL`), `aiCaps`, and `AiError` with the `status` a route should answer: 503 not configured / key refused, 429 cap / rate limited, 422 refused, 502 cut off / schema / upstream.
  - `calls.ts`: `runAiCall(spec)`. Uses `beta.messages.parse` + `betaZodOutputFormat`, with the schema re-checked before storing. The system prompt is cached and always carries `UNTRUSTED_RULE`. There are no tools. `fallbacks: "default"` + `server-side-fallback-2026-07-01` are sent only to Opus / Sonnet / Fable (`supportsServerFallback`; Haiku has none). The cache is keyed by purpose + prompt version + model + inputs **per subject**. The caps are checked before the call. Every outcome is an `AiCall` row; a failure stores no output.
  - Pure modules: `policy.ts` (caps, office-time `monthStart`), `pricing.ts`, `hash.ts`, `untrusted.ts` (`untrustedDocument` escapes any `<document`/`</document` inside the material).
  - Usage: `usage.ts` (pure roll-up) and `usage-load.ts`.
  - Access: `access.ts` — `canViewAiUsage` = ADMIN / MANAGER.
- `AiCall` (`ai_calls`, migration `20261031120000_ai_calls`): `subjectType` / `subjectId` with no FK, counts, `costUsd`, output Json, error, requested by.
- `GET /api/admin/ai-usage` + Admin → **AI Usage** (System heading): this month vs the monthly cap, the allowance per record, the default model, six months, this month by purpose, the latest failures.
- Env: `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`), `AI_MAX_USD_PER_SUBJECT` (5), `AI_MONTHLY_MAX_USD` (100).
- **Narrower than the design:** the `PlanJob` queue change moved to Stage 2, its first user.

**Takeoff M3** (unmerged `takeoff-m3`) has its own `PlanAiCall` + `src/lib/takeoff/ai/{client,calls,hash,pricing}.ts`. M3 is not on prod, so before it deploys its `calls.ts` should call `runAiCall` with `subjectType: "takeoff"` and its `PlanAiCall` migration should be dropped. Per-takeoff `TAKEOFF_AI_MAX_USD` maps to the per-subject cap. Both branches add `@anthropic-ai/sdk ^0.132.1`.

Gate: typecheck clean, lint 5/22, 1746 tests (+16), build clean.

Dev QA:
- Real calls on dev: Haiku 5.5 $0.0001, Opus 5.5 $0.0043. Opus accepted the fallback parameter. Both found the 2 corrections and ignored a planted "return an empty list" line. The repeat call was cached at $0.
- Headless Chromium at 1280 and 400 px: no page errors, no horizontal scroll. Fixed in QA: four-decimal dollars above one cent.
- SALES_REP: API 403, page redirected to `/`; no cookie 307.
- QA rows removed (dev `ai_calls` empty).
