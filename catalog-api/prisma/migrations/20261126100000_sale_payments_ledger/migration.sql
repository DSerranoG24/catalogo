-- Pagos de la venta F2a-1 (docs/sales-payments-cartera-contract.md). Additive only, one transaction:
-- 4 enums, 3 nullable/defaulted columns on "Sale", 4 new tables, indexes, CHECKs, functions and triggers.
-- Existing sales become LEGACY through the column default (no row rewrite, no UPDATE); the column default stays
-- LEGACY so the API published before F2a-2 keeps creating LEGACY sales. The F2a-2 API switches a DRAFT to TRACKED on confirm.
BEGIN;
-- Fail fast instead of queueing behind a long transaction on "Sale" (ACCESS EXCLUSIVE for ADD COLUMN).
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "SalePaymentMode" AS ENUM ('TRACKED', 'LEGACY');

-- CreateEnum
CREATE TYPE "SalePaymentMethod" AS ENUM ('CASH', 'NEQUI', 'DAVIPLATA', 'BANK_TRANSFER', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "SalePaymentEntryKind" AS ENUM ('PAYMENT', 'CREDIT_USE', 'EXCESS_TO_CREDIT', 'SALE_REFUND', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CustomerCreditEntryKind" AS ENUM ('FROM_SALE', 'USED', 'REFUND', 'REVERSAL');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "paymentDueDate" DATE,
ADD COLUMN     "paymentMode" "SalePaymentMode" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "paymentTermDays" INTEGER;

-- CreateTable
CREATE TABLE "sale_payment_entries" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" "SalePaymentEntryKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "SalePaymentMethod",
    "methodNote" VARCHAR(80),
    "reference" VARCHAR(100),
    "cashReceived" BIGINT,
    "creditEntryId" TEXT,
    "reversesEntryId" TEXT,
    "reason" VARCHAR(300),
    "operationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_entries" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "CustomerCreditEntryKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "saleId" TEXT,
    "method" "SalePaymentMethod",
    "methodNote" VARCHAR(80),
    "reference" VARCHAR(100),
    "reversesEntryId" TEXT,
    "reason" VARCHAR(300),
    "operationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_money_operations" (
    "ownerId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_money_operations_pkey" PRIMARY KEY ("ownerId","operationId")
);

-- CreateTable
CREATE TABLE "receivable_settings" (
    "ownerId" TEXT NOT NULL,
    "defaultTermDays" INTEGER NOT NULL DEFAULT 30,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivable_settings_pkey" PRIMARY KEY ("ownerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_payment_entries_reversesEntryId_key" ON "sale_payment_entries"("reversesEntryId");

-- CreateIndex
CREATE INDEX "sale_payment_entries_ownerId_saleId_createdAt_idx" ON "sale_payment_entries"("ownerId", "saleId", "createdAt");

-- CreateIndex
CREATE INDEX "sale_payment_entries_creditEntryId_ownerId_idx" ON "sale_payment_entries"("creditEntryId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_payment_entries_id_ownerId_key" ON "sale_payment_entries"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_payment_entries_id_saleId_key" ON "sale_payment_entries"("id", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_payment_entries_ownerId_operationId_saleId_position_key" ON "sale_payment_entries"("ownerId", "operationId", "saleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_reversesEntryId_key" ON "customer_credit_entries"("reversesEntryId");

-- CreateIndex
CREATE INDEX "customer_credit_entries_ownerId_customerId_createdAt_idx" ON "customer_credit_entries"("ownerId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_credit_entries_saleId_ownerId_idx" ON "customer_credit_entries"("saleId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_id_ownerId_key" ON "customer_credit_entries"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_id_customerId_key" ON "customer_credit_entries"("id", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_entries_ownerId_operationId_position_key" ON "customer_credit_entries"("ownerId", "operationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sale_money_operations_ownerId_requestId_key" ON "sale_money_operations"("ownerId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_id_userId_key" ON "Sale"("id", "userId");

-- AddForeignKey
ALTER TABLE "sale_payment_entries" ADD CONSTRAINT "sale_payment_entries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payment_entries" ADD CONSTRAINT "sale_payment_entries_saleId_ownerId_fkey" FOREIGN KEY ("saleId", "ownerId") REFERENCES "Sale"("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sale_payment_entries" ADD CONSTRAINT "sale_payment_entries_creditEntryId_ownerId_fkey" FOREIGN KEY ("creditEntryId", "ownerId") REFERENCES "customer_credit_entries"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sale_payment_entries" ADD CONSTRAINT "sale_payment_entries_reversesEntryId_saleId_fkey" FOREIGN KEY ("reversesEntryId", "saleId") REFERENCES "sale_payment_entries"("id", "saleId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_customerId_ownerId_fkey" FOREIGN KEY ("customerId", "ownerId") REFERENCES "customers"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_saleId_ownerId_fkey" FOREIGN KEY ("saleId", "ownerId") REFERENCES "Sale"("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_reversesEntryId_customerId_fkey" FOREIGN KEY ("reversesEntryId", "customerId") REFERENCES "customer_credit_entries"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sale_money_operations" ADD CONSTRAINT "sale_money_operations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_settings" ADD CONSTRAINT "receivable_settings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---- Rules Prisma cannot represent ----

-- "Sale": payment columns. LEGACY sales carry no term or due date; a due date needs a delivery.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_payment_columns_check" CHECK (
  ("paymentTermDays" IS NULL OR "paymentTermDays" BETWEEN 0 AND 365)
  AND ("paymentMode" = 'TRACKED' OR ("paymentTermDays" IS NULL AND "paymentDueDate" IS NULL))
  AND ("paymentDueDate" IS NULL OR ("deliveredAt" IS NOT NULL AND "paymentDueDate" >= DATE '2000-01-01')));

ALTER TABLE "sale_payment_entries" ADD CONSTRAINT "sale_payment_entries_valid_check" CHECK (
  "amount" > 0 AND "amount" <= 1000000000000
  AND "position" > 0
  AND length("operationId") BETWEEN 1 AND 64
  AND ("method" IS NOT NULL OR "methodNote" IS NULL)
  AND ("method" IS NULL OR (("method" = 'OTHER') = ("methodNote" IS NOT NULL)))
  AND ("methodNote" IS NULL OR length(btrim("methodNote")) BETWEEN 3 AND 80)
  AND ("reference" IS NULL OR length(btrim("reference")) BETWEEN 1 AND 100)
  AND ("reason" IS NULL OR length(btrim("reason")) BETWEEN 3 AND 300)
  AND ("cashReceived" IS NULL OR ("kind" = 'PAYMENT' AND "method" = 'CASH' AND "cashReceived" >= "amount" AND "cashReceived" <= 1000000000000)));
-- Columns allowed per kind. PAYMENT and SALE_REFUND carry a real method; CREDIT_USE and EXCESS_TO_CREDIT pair with a
-- customer credit entry; REVERSAL undoes one entry and needs a reason.
ALTER TABLE "sale_payment_entries" ADD CONSTRAINT "sale_payment_entries_kind_check" CHECK (
     ("kind" = 'PAYMENT' AND "method" IS NOT NULL AND "creditEntryId" IS NULL AND "reversesEntryId" IS NULL AND "reason" IS NULL)
  OR ("kind" = 'SALE_REFUND' AND "method" IS NOT NULL AND "creditEntryId" IS NULL AND "reversesEntryId" IS NULL)
  OR ("kind" IN ('CREDIT_USE', 'EXCESS_TO_CREDIT') AND "method" IS NULL AND "reference" IS NULL AND "creditEntryId" IS NOT NULL
      AND "reversesEntryId" IS NULL AND "reason" IS NULL)
  OR ("kind" = 'REVERSAL' AND "method" IS NULL AND "reference" IS NULL AND "reversesEntryId" IS NOT NULL AND "reason" IS NOT NULL));
-- A customer credit entry is paired with at most one sale entry.
CREATE UNIQUE INDEX "sale_payment_entries_creditEntryId_key" ON "sale_payment_entries"("creditEntryId") WHERE "creditEntryId" IS NOT NULL;

ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_valid_check" CHECK (
  "amount" > 0 AND "amount" <= 1000000000000
  AND "position" > 0
  AND length("operationId") BETWEEN 1 AND 64
  AND ("method" IS NOT NULL OR "methodNote" IS NULL)
  AND ("method" IS NULL OR (("method" = 'OTHER') = ("methodNote" IS NOT NULL)))
  AND ("methodNote" IS NULL OR length(btrim("methodNote")) BETWEEN 3 AND 80)
  AND ("reference" IS NULL OR length(btrim("reference")) BETWEEN 1 AND 100)
  AND ("reason" IS NULL OR length(btrim("reason")) BETWEEN 3 AND 300));
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_kind_check" CHECK (
     ("kind" IN ('FROM_SALE', 'USED') AND "saleId" IS NOT NULL AND "method" IS NULL AND "reference" IS NULL AND "reversesEntryId" IS NULL AND "reason" IS NULL)
  OR ("kind" = 'REFUND' AND "saleId" IS NULL AND "method" IS NOT NULL AND "reversesEntryId" IS NULL)
  OR ("kind" = 'REVERSAL' AND "method" IS NULL AND "reference" IS NULL AND "reversesEntryId" IS NOT NULL AND "reason" IS NOT NULL));

ALTER TABLE "sale_money_operations" ADD CONSTRAINT "sale_money_operations_valid_check" CHECK (
  "requestHash" ~ '^[0-9a-f]{64}$' AND length(btrim("kind")) BETWEEN 1 AND 40
  AND length("operationId") BETWEEN 1 AND 64 AND length("requestId") BETWEEN 1 AND 64 AND length("resourceId") BETWEEN 1 AND 64);

ALTER TABLE "receivable_settings" ADD CONSTRAINT "receivable_settings_valid_check" CHECK ("defaultTermDays" BETWEEN 0 AND 365 AND "version" > 0);

-- Append-only: the money ledgers and their receipts are never updated, deleted or truncated.
CREATE FUNCTION money_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MONEY_LEDGER_APPEND_ONLY' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER sale_payment_entries_append_only BEFORE UPDATE OR DELETE ON "sale_payment_entries"
  FOR EACH ROW EXECUTE FUNCTION money_append_only_guard();
CREATE TRIGGER sale_payment_entries_no_truncate BEFORE TRUNCATE ON "sale_payment_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION money_append_only_guard();
CREATE TRIGGER customer_credit_entries_append_only BEFORE UPDATE OR DELETE ON "customer_credit_entries"
  FOR EACH ROW EXECUTE FUNCTION money_append_only_guard();
CREATE TRIGGER customer_credit_entries_no_truncate BEFORE TRUNCATE ON "customer_credit_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION money_append_only_guard();
CREATE TRIGGER sale_money_operations_append_only BEFORE UPDATE OR DELETE ON "sale_money_operations"
  FOR EACH ROW EXECUTE FUNCTION money_append_only_guard();
CREATE TRIGGER sale_money_operations_no_truncate BEFORE TRUNCATE ON "sale_money_operations"
  FOR EACH STATEMENT EXECUTE FUNCTION money_append_only_guard();

-- Settings are edited, never deleted; the owner is frozen.
CREATE FUNCTION receivable_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'RECEIVABLE_SETTINGS_GUARD' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receivable_settings_guard BEFORE UPDATE OR DELETE ON "receivable_settings"
  FOR EACH ROW EXECUTE FUNCTION receivable_settings_guard();

-- "Sale" payment columns: paymentMode only LEGACY -> TRACKED while DRAFT (the confirm update); the term only while
-- DRAFT or CONFIRMED; the due date only set (never cleared) on a DELIVERED TRACKED sale. The customer of a TRACKED
-- sale is frozen once it is delivered (correction B). LEGACY sales keep today's behaviour.
CREATE FUNCTION sale_payment_columns_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."paymentMode" IS DISTINCT FROM OLD."paymentMode"
     AND NOT (OLD."paymentMode" = 'LEGACY' AND NEW."paymentMode" = 'TRACKED' AND OLD."status" = 'DRAFT') THEN
    RAISE EXCEPTION 'SALE_PAYMENT_MODE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW."paymentTermDays" IS DISTINCT FROM OLD."paymentTermDays" AND OLD."status" NOT IN ('DRAFT', 'CONFIRMED') THEN
    RAISE EXCEPTION 'SALE_PAYMENT_TERM_LOCKED' USING ERRCODE = '23514';
  END IF;
  IF NEW."paymentDueDate" IS DISTINCT FROM OLD."paymentDueDate"
     AND (NEW."paymentDueDate" IS NULL OR NEW."status" <> 'DELIVERED' OR NEW."paymentMode" <> 'TRACKED') THEN
    RAISE EXCEPTION 'SALE_PAYMENT_DUE_DATE_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NEW."customerId" IS DISTINCT FROM OLD."customerId" AND OLD."paymentMode" = 'TRACKED' AND OLD."status" NOT IN ('DRAFT', 'CONFIRMED') THEN
    RAISE EXCEPTION 'SALE_CUSTOMER_LOCKED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_payment_columns_guard BEFORE UPDATE OF "paymentMode", "paymentTermDays", "paymentDueDate", "customerId" ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION sale_payment_columns_guard();

-- Insert rules of the sale ledger: only TRACKED, non-draft sales; a reversal undoes one non-reversal entry of the same
-- sale for the same amount; credit pairing matches kind, amount, sale and the sale's customer. SALE_REFUND only
-- without a customer (with a customer, the excess goes to the credit balance and is refunded from there).
CREATE FUNCTION sale_payment_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale RECORD; reversed RECORD; credit RECORD;
BEGIN
  SELECT "status", "paymentMode", "customerId" INTO sale FROM "Sale" WHERE "id" = NEW."saleId";
  IF sale."paymentMode" IS DISTINCT FROM 'TRACKED' OR sale."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'SALE_PAYMENTS_NOT_TRACKED' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'SALE_REFUND' AND sale."customerId" IS NOT NULL THEN
    RAISE EXCEPTION 'SALE_REFUND_REQUIRES_NO_CUSTOMER' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'REVERSAL' THEN
    SELECT "kind", "amount", "creditEntryId" INTO reversed FROM "sale_payment_entries" WHERE "id" = NEW."reversesEntryId";
    IF reversed."kind" = 'REVERSAL' OR reversed."amount" <> NEW."amount"
       OR (reversed."creditEntryId" IS NULL) <> (NEW."creditEntryId" IS NULL) THEN
      RAISE EXCEPTION 'SALE_PAYMENT_REVERSAL_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW."creditEntryId" IS NOT NULL THEN
      SELECT "kind", "reversesEntryId" INTO credit FROM "customer_credit_entries" WHERE "id" = NEW."creditEntryId";
      IF credit."kind" <> 'REVERSAL' OR credit."reversesEntryId" IS DISTINCT FROM reversed."creditEntryId" THEN
        RAISE EXCEPTION 'SALE_PAYMENT_CREDIT_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW."creditEntryId" IS NOT NULL THEN
    SELECT "kind", "amount", "saleId", "customerId" INTO credit FROM "customer_credit_entries" WHERE "id" = NEW."creditEntryId";
    IF credit."kind"::text <> (CASE NEW."kind" WHEN 'CREDIT_USE' THEN 'USED' ELSE 'FROM_SALE' END)
       OR credit."amount" <> NEW."amount" OR credit."saleId" IS DISTINCT FROM NEW."saleId"
       OR credit."customerId" IS DISTINCT FROM sale."customerId" THEN
      RAISE EXCEPTION 'SALE_PAYMENT_CREDIT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_payment_entries_insert_guard BEFORE INSERT ON "sale_payment_entries"
  FOR EACH ROW EXECUTE FUNCTION sale_payment_entry_insert_guard();

CREATE FUNCTION customer_credit_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reversed RECORD;
BEGIN
  IF NEW."kind" = 'REVERSAL' THEN
    SELECT "kind", "amount", "saleId" INTO reversed FROM "customer_credit_entries" WHERE "id" = NEW."reversesEntryId";
    IF reversed."kind" = 'REVERSAL' OR reversed."amount" <> NEW."amount" OR NEW."saleId" IS DISTINCT FROM reversed."saleId" THEN
      RAISE EXCEPTION 'CUSTOMER_CREDIT_REVERSAL_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_credit_entries_insert_guard BEFORE INSERT ON "customer_credit_entries"
  FOR EACH ROW EXECUTE FUNCTION customer_credit_entry_insert_guard();

-- Balance of one TRACKED sale, checked at commit (contract 5.1 and 5.6):
--   effective = 0 if CANCELLED/RETURNED, else total - value returned ((unitPrice - unitDiscount) x receivedQuantity);
--   paid = PAYMENT + CREDIT_USE - EXCESS_TO_CREDIT - SALE_REFUND, a REVERSAL counting against its entry.
-- Always 0 <= paid. With a customer, paid <= effective (any excess must move to the credit balance in the same
-- transaction). Without a customer, paid <= total: the excess of a cancelled or returned sale is "por devolver".
-- Non-reversed credit entries of the sale must belong to the sale's current customer.
CREATE FUNCTION sale_payment_balance_check(sid TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE sale RECORD; returned NUMERIC; effective NUMERIC; paid NUMERIC;
BEGIN
  SELECT "status", "paymentMode", "customerId", "total" INTO sale FROM "Sale" WHERE "id" = sid;
  IF sale."paymentMode" IS DISTINCT FROM 'TRACKED' THEN RETURN; END IF;
  SELECT coalesce(sum((l."unitPrice" - l."unitDiscount") * rl."receivedQuantity"), 0) INTO returned
    FROM "SaleReturnLine" rl JOIN "SaleReturn" r ON r."id" = rl."returnId" JOIN "SaleLine" l ON l."id" = rl."saleLineId"
   WHERE r."saleId" = sid;
  effective := CASE WHEN sale."status" IN ('CANCELLED', 'RETURNED') THEN 0 ELSE sale."total" - returned END;
  SELECT coalesce(sum(CASE
      WHEN e."kind" IN ('PAYMENT', 'CREDIT_USE') THEN e."amount"
      WHEN e."kind" IN ('EXCESS_TO_CREDIT', 'SALE_REFUND') THEN -e."amount"
      WHEN o."kind" IN ('PAYMENT', 'CREDIT_USE') THEN -e."amount"
      ELSE e."amount" END), 0) INTO paid
    FROM "sale_payment_entries" e LEFT JOIN "sale_payment_entries" o ON o."id" = e."reversesEntryId"
   WHERE e."saleId" = sid;
  IF paid < 0 OR paid > sale."total" OR (sale."customerId" IS NOT NULL AND paid > effective) THEN
    RAISE EXCEPTION 'SALE_PAYMENT_BALANCE_INVALID' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "sale_payment_entries" e JOIN "customer_credit_entries" c ON c."id" = e."creditEntryId"
              WHERE e."saleId" = sid AND e."kind" IN ('CREDIT_USE', 'EXCESS_TO_CREDIT')
                AND c."customerId" IS DISTINCT FROM sale."customerId"
                AND NOT EXISTS (SELECT 1 FROM "sale_payment_entries" r WHERE r."reversesEntryId" = e."id")) THEN
    RAISE EXCEPTION 'SALE_PAYMENT_CUSTOMER_MISMATCH' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION sale_payment_balance_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sale_payment_balance_check(CASE TG_TABLE_NAME
    WHEN 'sale_payment_entries' THEN to_jsonb(NEW) ->> 'saleId'
    WHEN 'Sale' THEN to_jsonb(NEW) ->> 'id'
    ELSE (SELECT r."saleId" FROM "SaleReturn" r WHERE r."id" = to_jsonb(NEW) ->> 'returnId') END);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sale_payment_entries_balance AFTER INSERT ON "sale_payment_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sale_payment_balance_trigger();
CREATE CONSTRAINT TRIGGER sale_payment_status_balance AFTER UPDATE OF "status", "customerId" ON "Sale"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."paymentMode" = 'TRACKED') EXECUTE FUNCTION sale_payment_balance_trigger();
CREATE CONSTRAINT TRIGGER sale_return_line_payment_balance AFTER INSERT ON "SaleReturnLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sale_payment_balance_trigger();

-- Customer credit balance, checked at commit: never negative. FROM_SALE and USED (and their reversals) must be paired
-- with a sale ledger entry, so the credit balance and the sales always tell the same story.
CREATE FUNCTION customer_credit_balance_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance NUMERIC;
BEGIN
  SELECT coalesce(sum(CASE
      WHEN c."kind" = 'FROM_SALE' THEN c."amount"
      WHEN c."kind" IN ('USED', 'REFUND') THEN -c."amount"
      WHEN o."kind" = 'FROM_SALE' THEN -c."amount"
      ELSE c."amount" END), 0) INTO balance
    FROM "customer_credit_entries" c LEFT JOIN "customer_credit_entries" o ON o."id" = c."reversesEntryId"
   WHERE c."customerId" = NEW."customerId";
  IF balance < 0 THEN RAISE EXCEPTION 'CUSTOMER_CREDIT_NEGATIVE' USING ERRCODE = '23514'; END IF;
  IF NEW."saleId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sale_payment_entries" e WHERE e."creditEntryId" = NEW."id") THEN
    RAISE EXCEPTION 'CUSTOMER_CREDIT_UNPAIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_credit_entries_balance AFTER INSERT ON "customer_credit_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_credit_balance_trigger();

COMMIT;
