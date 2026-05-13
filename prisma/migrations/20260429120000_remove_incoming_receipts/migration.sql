-- Remove incoming_receipts. Replaced by the cc-allocator integration.
-- Uses IF EXISTS so this works whether the incoming_receipts table is
-- present (other environments) or already dropped (dev DB drift).
-- DROP TABLE cascades to its constraints and indexes; no need to drop
-- those separately.

DROP TABLE IF EXISTS "incoming_receipts" CASCADE;

DROP TYPE IF EXISTS "IncomingReceiptStatus";
