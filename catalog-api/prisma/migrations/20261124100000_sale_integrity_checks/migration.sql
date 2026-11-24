-- Sales integrity CHECK constraints required by docs/sales-contract.md.
-- Additive only: no data is updated, backfilled or deleted. Prisma 6 does not
-- represent CHECK constraints in schema.prisma; they live here.
--
-- Before applying to a database with data, run docs/sql/verify-sale-integrity.sql
-- (read-only). If any CHECK row reports violations, this migration fails as a whole
-- and leaves the schema unchanged.
--
-- Equations use numeric so that corrupt values are rejected as a violation instead
-- of raising a bigint overflow while the constraint is evaluated.
BEGIN;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_currency_check"
  CHECK ("currency" = 'COP');
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amounts_nonnegative_check"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "total" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_discount_within_subtotal_check"
  CHECK ("discountTotal" <= "subtotal");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_total_equation_check"
  CHECK ("subtotal"::numeric - "discountTotal"::numeric = "total"::numeric);

ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_quantity_positive_check"
  CHECK ("quantity" > 0);
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_amounts_nonnegative_check"
  CHECK ("unitPrice" >= 0 AND "unitDiscount" >= 0 AND "lineTotal" >= 0 AND ("unitCost" IS NULL OR "unitCost" >= 0));
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_discount_within_price_check"
  CHECK ("unitDiscount" <= "unitPrice");
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_total_equation_check"
  CHECK (("unitPrice"::numeric - "unitDiscount"::numeric) * "quantity"::numeric = "lineTotal"::numeric);

ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_received_positive_check"
  CHECK ("receivedQuantity" > 0);
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_split_nonnegative_check"
  CHECK ("resellableQuantity" >= 0 AND "damagedQuantity" >= 0);
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_split_equation_check"
  CHECK ("resellableQuantity"::numeric + "damagedQuantity"::numeric = "receivedQuantity"::numeric);

COMMIT;
