BEGIN;

-- Keep arithmetic valid for every writer, including future sales integrations.
-- bigint prevents overflow while checking integer boundary values.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_balance_check" CHECK (
  ("type" = 'IN' AND "quantity" > 0 AND "resultingStock"::bigint = "previousStock"::bigint + "quantity"::bigint)
  OR ("type" = 'OUT' AND "quantity" > 0 AND "resultingStock"::bigint = "previousStock"::bigint - "quantity"::bigint)
  OR ("type" = 'ADJUSTMENT' AND "resultingStock" = "quantity")
) NOT VALID;

ALTER TABLE "inventory_movements" VALIDATE CONSTRAINT "inventory_movements_balance_check";

COMMIT;
