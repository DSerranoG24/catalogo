-- Allow sales to write inventory movements (origin = 'SALE').
--
-- 20261119000000_inventory_batches created two CHECK constraints that only accept
-- origin 'MANUAL' and 'INVENTORY_BATCH'. The sales service writes origin 'SALE', so
-- every sale confirmation, order conversion to CONFIRMED/DELIVERED, cancellation and
-- resellable return was rejected by the database.
--
-- This migration replaces both constraints (same names) so that:
--   * unknown origins are still rejected;
--   * origin 'SALE' requires saleId, saleLineId, saleMovementRole and actorUserId, and
--     forbids batch references;
--   * origins 'MANUAL' and 'INVENTORY_BATCH' keep their previous rules and now also
--     forbid sale references.
--
-- No data is updated. Existing rows are validated when the new constraints are added;
-- the movement ledger is immutable (trigger inventory_immutable_movement), so any
-- violating row cannot be repaired by this migration and makes it fail as a whole.
-- Run docs/sql/verify-sale-integrity.sql first.
BEGIN;

ALTER TABLE "inventory_movements"
  DROP CONSTRAINT "inventory_movements_origin_check",
  ADD CONSTRAINT "inventory_movements_origin_check"
    CHECK ("origin" IN ('MANUAL', 'INVENTORY_BATCH', 'SALE'));

ALTER TABLE "inventory_movements"
  DROP CONSTRAINT "inventory_movements_batch_check",
  ADD CONSTRAINT "inventory_movements_batch_check" CHECK (
    ("origin" = 'MANUAL'
      AND "batchId" IS NULL AND "batchRowId" IS NULL AND "batchOperationId" IS NULL
      AND "saleId" IS NULL AND "saleLineId" IS NULL AND "saleMovementRole" IS NULL)
    OR ("origin" = 'INVENTORY_BATCH'
      AND "batchId" IS NOT NULL AND "batchRowId" IS NOT NULL AND "batchOperationId" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "saleId" IS NULL AND "saleLineId" IS NULL AND "saleMovementRole" IS NULL)
    OR ("origin" = 'SALE'
      AND "saleId" IS NOT NULL AND "saleLineId" IS NOT NULL AND "saleMovementRole" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "batchId" IS NULL AND "batchRowId" IS NULL AND "batchOperationId" IS NULL)
  );

COMMIT;
