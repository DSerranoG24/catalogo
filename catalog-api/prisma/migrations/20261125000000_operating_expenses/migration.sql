-- Gastos F1 (docs/expenses-contract.md v1.2): categories, one-off expenses, the F1b
-- recurring-template table (no endpoints yet), operation receipts and immutable events.
-- Additive: creates new types, tables, constraints, functions and triggers only. No
-- existing table is altered and no data is inserted (categories are seeded per account
-- by POST /expense-categories/seed). Run docs/sql/verify-expenses-preflight.sql first.
BEGIN;

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'SKIPPED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'RECURRING');

-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'NEQUI', 'DAVIPLATA', 'BANK_TRANSFER', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurringExpenseStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ExpenseFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "normalizedKey" VARCHAR(240) NOT NULL,
    "seedKey" VARCHAR(40),
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expense_templates" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "RecurringExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" VARCHAR(300) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "paymentMethod" "ExpensePaymentMethod" NOT NULL,
    "paymentMethodNote" VARCHAR(80),
    "supplierName" VARCHAR(160),
    "estimatedAmount" BIGINT,
    "frequency" "ExpenseFrequency" NOT NULL,
    "interval" INTEGER NOT NULL,
    "anchorDate" DATE NOT NULL,
    "endDate" DATE,
    "generatedThrough" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "recurring_expense_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "ExpenseSource" NOT NULL DEFAULT 'MANUAL',
    "templateId" TEXT,
    "occurrenceDate" DATE,
    "expenseDate" DATE NOT NULL,
    "amount" BIGINT,
    "suggestedAmount" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "taxMode" VARCHAR(20) NOT NULL DEFAULT 'NOT_MANAGED',
    "categoryId" TEXT NOT NULL,
    "categoryNameSnapshot" VARCHAR(60),
    "paymentMethod" "ExpensePaymentMethod" NOT NULL,
    "paymentMethodNote" VARCHAR(80),
    "paymentReference" VARCHAR(100),
    "description" VARCHAR(300) NOT NULL,
    "supplierName" VARCHAR(160),
    "replacesExpenseId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "skipReason" VARCHAR(300),
    "voidedAt" TIMESTAMP(3),
    "voidReason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_operations" (
    "ownerId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_operations_pkey" PRIMARY KEY ("ownerId","operationId")
);

-- CreateTable
CREATE TABLE "expense_events" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "operationId" TEXT,
    "entityKind" VARCHAR(20) NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" VARCHAR(40) NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_ownerId_position_id_idx" ON "expense_categories"("ownerId", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_id_ownerId_key" ON "expense_categories"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_ownerId_normalizedKey_key" ON "expense_categories"("ownerId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_ownerId_seedKey_key" ON "expense_categories"("ownerId", "seedKey");

-- CreateIndex
CREATE INDEX "recurring_expense_templates_ownerId_status_idx" ON "recurring_expense_templates"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_expense_templates_id_ownerId_key" ON "recurring_expense_templates"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_replacesExpenseId_key" ON "expenses"("replacesExpenseId");

-- CreateIndex
CREATE INDEX "expenses_ownerId_status_expenseDate_id_idx" ON "expenses"("ownerId", "status", "expenseDate", "id");

-- CreateIndex
CREATE INDEX "expenses_ownerId_categoryId_expenseDate_idx" ON "expenses"("ownerId", "categoryId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_ownerId_paymentMethod_expenseDate_idx" ON "expenses"("ownerId", "paymentMethod", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_ownerId_status_templateId_idx" ON "expenses"("ownerId", "status", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_id_ownerId_key" ON "expenses"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_templateId_occurrenceDate_key" ON "expenses"("templateId", "occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "expense_operations_ownerId_requestId_key" ON "expense_operations"("ownerId", "requestId");

-- CreateIndex
CREATE INDEX "expense_events_ownerId_entityKind_entityId_occurredAt_id_idx" ON "expense_events"("ownerId", "entityKind", "entityId", "occurredAt", "id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_categoryId_ownerId_fkey" FOREIGN KEY ("categoryId", "ownerId") REFERENCES "expense_categories"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_ownerId_fkey" FOREIGN KEY ("categoryId", "ownerId") REFERENCES "expense_categories"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_templateId_ownerId_fkey" FOREIGN KEY ("templateId", "ownerId") REFERENCES "recurring_expense_templates"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_replacesExpenseId_ownerId_fkey" FOREIGN KEY ("replacesExpenseId", "ownerId") REFERENCES "expenses"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expense_operations" ADD CONSTRAINT "expense_operations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_ownerId_operationId_fkey" FOREIGN KEY ("ownerId", "operationId") REFERENCES "expense_operations"("ownerId", "operationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ---- CHECK constraints (not representable in Prisma 6) ----
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_valid_check" CHECK (
  length(btrim("name")) BETWEEN 1 AND 60 AND length("normalizedKey") > 0 AND "position" >= 0 AND "version" > 0
  AND ("seedKey" IS NULL OR length("seedKey") > 0));

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_money_check" CHECK (
  ("amount" IS NULL OR ("amount" > 0 AND "amount" <= 1000000000000))
  AND ("suggestedAmount" IS NULL OR ("suggestedAmount" > 0 AND "suggestedAmount" <= 1000000000000))
  AND "currency" = 'COP' AND "taxMode" = 'NOT_MANAGED');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_date_check" CHECK ("expenseDate" >= DATE '2000-01-01');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_check" CHECK (
  (("paymentMethod" = 'OTHER') = ("paymentMethodNote" IS NOT NULL))
  AND ("paymentMethodNote" IS NULL OR length(btrim("paymentMethodNote")) BETWEEN 3 AND 80)
  AND ("paymentReference" IS NULL OR length(btrim("paymentReference")) BETWEEN 1 AND 100));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_text_check" CHECK (
  length(btrim("description")) BETWEEN 1 AND 300
  AND ("supplierName" IS NULL OR length(btrim("supplierName")) BETWEEN 1 AND 160)
  AND ("replacesExpenseId" IS NULL OR "replacesExpenseId" <> "id") AND "version" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_status_check" CHECK (
     ("status" = 'CONFIRMED' AND "amount" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "voidedAt" IS NULL AND "voidReason" IS NULL AND "skippedAt" IS NULL)
  OR ("status" = 'VOIDED' AND "amount" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "voidedAt" IS NOT NULL
      AND length(btrim(coalesce("voidReason", ''))) BETWEEN 3 AND 300 AND "skippedAt" IS NULL)
  OR ("status" = 'PENDING_CONFIRMATION' AND "amount" IS NULL AND "source" = 'RECURRING' AND "confirmedAt" IS NULL AND "voidedAt" IS NULL AND "skippedAt" IS NULL)
  OR ("status" = 'SKIPPED' AND "amount" IS NULL AND "source" = 'RECURRING' AND "skippedAt" IS NOT NULL AND "confirmedAt" IS NULL AND "voidedAt" IS NULL));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_source_check" CHECK (
     ("source" = 'RECURRING' AND "templateId" IS NOT NULL AND "occurrenceDate" IS NOT NULL)
  OR ("source" = 'MANUAL' AND "templateId" IS NULL AND "occurrenceDate" IS NULL AND "suggestedAmount" IS NULL));

ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_valid_check" CHECK (
  "interval" BETWEEN 1 AND 12 AND ("endDate" IS NULL OR "endDate" >= "anchorDate")
  AND ("estimatedAmount" IS NULL OR ("estimatedAmount" > 0 AND "estimatedAmount" <= 1000000000000))
  AND (("paymentMethod" = 'OTHER') = ("paymentMethodNote" IS NOT NULL))
  AND length(btrim("description")) BETWEEN 1 AND 300 AND "version" > 0);

ALTER TABLE "expense_operations" ADD CONSTRAINT "expense_operations_valid_check" CHECK (
  "requestHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("responseSnapshot") = 'object');
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_valid_check" CHECK (
  jsonb_typeof("after") = 'object' AND ("before" IS NULL OR jsonb_typeof("before") = 'object'));

-- ---- Triggers ----
-- Receipts and events are immutable history.
CREATE FUNCTION expense_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'EXPENSE_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER expense_operations_immutable BEFORE UPDATE OR DELETE ON "expense_operations" FOR EACH ROW EXECUTE FUNCTION expense_history_immutable();
CREATE TRIGGER expense_events_immutable BEFORE UPDATE OR DELETE ON "expense_events" FOR EACH ROW EXECUTE FUNCTION expense_history_immutable();

-- Nothing is ever deleted; identity columns never change.
CREATE FUNCTION expense_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed TEXT[]; frozen TEXT[] := TG_ARGV;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EXPENSE_DELETE_FORBIDDEN' USING ERRCODE = '23514'; END IF;
  changed := ARRAY(SELECT n.key FROM jsonb_each(to_jsonb(NEW)) n WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key);
  IF changed && frozen THEN RAISE EXCEPTION 'EXPENSE_IDENTITY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_categories_guard BEFORE UPDATE OR DELETE ON "expense_categories" FOR EACH ROW EXECUTE FUNCTION expense_row_guard('id', 'ownerId', 'seedKey', 'createdAt');
CREATE TRIGGER recurring_expense_templates_guard BEFORE UPDATE OR DELETE ON "recurring_expense_templates" FOR EACH ROW EXECUTE FUNCTION expense_row_guard('id', 'ownerId', 'createdAt');

-- Expenses: a CONFIRMED expense may only be reclassified (category, its snapshot, description,
-- payment-method note) or voided. VOIDED and SKIPPED are terminal. Nothing is deleted.
CREATE FUNCTION expense_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EXPENSE_DELETE_FORBIDDEN' USING ERRCODE = '23514'; END IF;
  changed := ARRAY(SELECT n.key FROM jsonb_each(to_jsonb(NEW)) n WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key);
  IF changed && ARRAY['id', 'ownerId', 'source', 'templateId', 'occurrenceDate', 'recordedAt', 'replacesExpenseId', 'currency', 'taxMode'] THEN
    RAISE EXCEPTION 'EXPENSE_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND NEW."status" = 'CONFIRMED' THEN
    IF NOT changed <@ ARRAY['categoryId', 'categoryNameSnapshot', 'description', 'paymentMethodNote', 'version', 'updatedAt'] THEN
      RAISE EXCEPTION 'EXPENSE_CONFIRMED_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'CONFIRMED' AND NEW."status" = 'VOIDED' THEN
    IF NOT changed <@ ARRAY['status', 'voidedAt', 'voidReason', 'version', 'updatedAt'] THEN
      RAISE EXCEPTION 'EXPENSE_CONFIRMED_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'PENDING_CONFIRMATION' AND NEW."status" IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'SKIPPED') THEN
    NULL; -- F1b confirm/skip; CHECK constraints keep the row coherent.
  ELSE
    RAISE EXCEPTION 'INVALID_EXPENSE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_transition_guard BEFORE UPDATE OR DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION expense_transition_guard();

COMMIT;
