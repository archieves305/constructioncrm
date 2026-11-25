# AI Field Inspector — evaluation

Measures the inspector against people's reviews of real KNU photos, and compares
models on the same photos (design doc §16).

**Truth** for an area = what a person decided: findings they CONFIRMED (the AI's,
plus ones they added because the AI missed them) are real defects; findings they
DISMISSED are known false alarms. Scoring is pure and tested
(`src/lib/inspector/eval.ts`): a model's finding matches a real one on the same
photo when their boxes overlap or their titles say the same thing; one-to-one.

## 1. Export the set (on the droplet; read-only)

The set holds job photos, so it is written **outside the repository** (the
script refuses a folder inside it) and never committed.

```bash
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx scripts/eval/inspector/export-set.ts --out /home/knuco/inspector-eval/2026-12"'
scp -r knuco-droplet:/home/knuco/inspector-eval/2026-12 ~/knu-inspector-eval/
```

Options: `--include-open` (open inspections too), `--inspection INS-00007`
(repeatable), `--since 2026-11-25`. An area waits until none of its findings is
still PROPOSED.

## 2. Run models (on the Mac, against the dev database)

```bash
npx tsx scripts/eval/inspector/run-eval.ts --set ~/knu-inspector-eval/2026-12          # plan + rough cost, nothing spent
npx tsx scripts/eval/inspector/run-eval.ts --set ~/knu-inspector-eval/2026-12 --yes    # Sonnet 5.5 and Opus 5.5
```

Options: `--models a,b`, `--effort low|medium|high` (live inspector: medium for
Sonnet, high for "Closer look"), `--limit n`. Calls go through `runAiCall`
(subject type `inspection_eval`, one subject per area), so they are recorded and
capped, and a re-run of the same model on the same photos is free.

Results: `<set>/results/<time>/report.md` (precision, recall, F1, false alarms and
how many repeat a dismissed one, box hit rate at IoU ≥ 0.3, severity agreement,
cost, seconds per photo, per trade, every miss and false alarm) and `results.json`.

The design asks for 100–200 photos across trades before choosing the default model
or letting findings reach contractors or money. Small sets swing a lot.
