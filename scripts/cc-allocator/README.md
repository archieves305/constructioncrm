# One-off scripts run inside cc-allocator (audit trail)

These were run on knuco-droplet from `/var/www/cc-allocator` as user `knuco`
(`npx tsx scripts/<name>.ts`), then removed from that tree. They import
cc-allocator's own modules (`@/server/queues`, `./_env`) and will not compile
here; they are kept so the 2026-09-24 reconciliation is reproducible.

- `replay-crm-leg-2026-09-24.ts` — turned the CRM leg on for BNW Construction
  $11,694.15 (BankTxn `cmrf8hvy20hhz12e49t7nvzx0`, JOB-00010) and enqueued
  it; enqueued the 23 card credits after the CRM started accepting negatives.
- `replay-crm-credits-requeue-2026-09-24.ts` — BullMQ keeps `crm-<id>` job
  ids for days, so 21 credits whose earlier attempt had failed were no-ops on
  re-add; this removes the stale job and enqueues again. Note: it hangs on
  exit (open Redis handles) after doing its work — add a `process.exit` if
  reused.
