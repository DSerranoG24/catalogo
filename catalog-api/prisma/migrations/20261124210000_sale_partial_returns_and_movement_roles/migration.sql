-- Sales rules after the 2026-11-24 production test.
--
-- 1. inventory_movements_sale_role_type_check: the sale role decides the movement type.
--    SALE_CONFIRMATION is always OUT; SALE_CANCELLATION and SALE_RETURN_RESELLABLE are
--    always IN. SALE_RETURN_DAMAGED stays in the enum but is never written (damaged
--    units do not return to stock), so the constraint rejects it. Existing rows are
--    validated: run docs/sql/verify-sale-integrity.sql first.
-- 2. Partial returns. No unique constraint ever limited a sale to one return
--    ("SaleReturn".operationId and ("returnId", "saleLineId") are per return); only the
--    service did. This adds the per-line index used to sum what was already returned
--    and a trigger that, under a lock on the sold line, rejects returning more than
--    was sold or attaching a return line to another sale's return.
-- 3. sale_status_transition_guard: allowed status changes only. It fires on future
--    updates, so historical rows (including a test sale cancelled after delivery
--    before this rule existed) are not rewritten or rejected.
--
-- No data is updated. Additive: one CHECK, one index, two functions and two triggers.
BEGIN;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sale_role_type_check" CHECK (
  "saleMovementRole" IS NULL
  OR ("saleMovementRole" = 'SALE_CONFIRMATION' AND "type" = 'OUT')
  OR ("saleMovementRole" IN ('SALE_CANCELLATION', 'SALE_RETURN_RESELLABLE') AND "type" = 'IN')
);

CREATE INDEX "SaleReturnLine_saleLineId_idx" ON "SaleReturnLine"("saleLineId");

CREATE FUNCTION sale_return_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_sale TEXT; line_quantity INTEGER; return_sale TEXT; already BIGINT;
BEGIN
  -- Serializes concurrent returns of the same sold line across transactions.
  SELECT "saleId", "quantity" INTO line_sale, line_quantity FROM "SaleLine" WHERE "id" = NEW."saleLineId" FOR UPDATE;
  SELECT "saleId" INTO return_sale FROM "SaleReturn" WHERE "id" = NEW."returnId";
  IF line_sale IS NULL OR return_sale IS DISTINCT FROM line_sale THEN
    RAISE EXCEPTION 'SALE_RETURN_LINE_SALE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum("receivedQuantity"), 0) INTO already FROM "SaleReturnLine"
   WHERE "saleLineId" = NEW."saleLineId" AND "id" <> NEW."id";
  IF already + NEW."receivedQuantity" > line_quantity THEN
    RAISE EXCEPTION 'SALE_RETURN_EXCEEDS_SOLD' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_return_line_guard BEFORE INSERT OR UPDATE ON "SaleReturnLine"
  FOR EACH ROW EXECUTE FUNCTION sale_return_line_guard();

CREATE FUNCTION sale_status_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('CONFIRMED', 'DELIVERED'))
    OR (OLD."status" = 'CONFIRMED' AND NEW."status" IN ('DELIVERED', 'CANCELLED'))
    OR (OLD."status" = 'DELIVERED' AND NEW."status" = 'RETURNED')
  ) THEN
    RAISE EXCEPTION 'INVALID_SALE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_status_transition_guard BEFORE UPDATE OF "status" ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION sale_status_transition_guard();

COMMIT;
