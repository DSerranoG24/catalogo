-- Gastos F1b (docs/expenses-f1b-contract.md): fixed expenses and scheduled payments. Additive only:
-- a new table and enum, a nullable column on expenses, indexes, CHECKs and triggers. One transaction.
BEGIN;

-- CreateEnum
CREATE TYPE "ScheduledExpenseStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "scheduledPaymentId" TEXT;

-- CreateTable
CREATE TABLE "scheduled_expense_payments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ScheduledExpenseStatus" NOT NULL DEFAULT 'PENDING',
    "templateId" TEXT,
    "occurrenceDate" DATE,
    "dueDate" DATE NOT NULL,
    "plannedAmount" BIGINT,
    "description" VARCHAR(300) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryNameSnapshot" VARCHAR(60),
    "paymentMethod" "ExpensePaymentMethod" NOT NULL,
    "paymentMethodNote" VARCHAR(80),
    "supplierName" VARCHAR(160),
    "customizedAt" TIMESTAMP(3),
    "paidExpenseId" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_expense_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_expense_payments_ownerId_status_dueDate_idx" ON "scheduled_expense_payments"("ownerId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "scheduled_expense_payments_ownerId_templateId_dueDate_idx" ON "scheduled_expense_payments"("ownerId", "templateId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_expense_payments_id_ownerId_key" ON "scheduled_expense_payments"("id", "ownerId");

-- CreateIndex
CREATE INDEX "expenses_ownerId_scheduledPaymentId_idx" ON "expenses"("ownerId", "scheduledPaymentId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_scheduledPaymentId_ownerId_fkey" FOREIGN KEY ("scheduledPaymentId", "ownerId") REFERENCES "scheduled_expense_payments"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scheduled_expense_payments" ADD CONSTRAINT "scheduled_expense_payments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expense_payments" ADD CONSTRAINT "scheduled_expense_payments_templateId_ownerId_fkey" FOREIGN KEY ("templateId", "ownerId") REFERENCES "recurring_expense_templates"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scheduled_expense_payments" ADD CONSTRAINT "scheduled_expense_payments_categoryId_ownerId_fkey" FOREIGN KEY ("categoryId", "ownerId") REFERENCES "expense_categories"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scheduled_expense_payments" ADD CONSTRAINT "scheduled_expense_payments_paidExpenseId_ownerId_fkey" FOREIGN KEY ("paidExpenseId", "ownerId") REFERENCES "expenses"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ---- Rules Prisma cannot represent ----
-- One occurrence per fixed-expense date. CANCELLED rows do not block (a schedule change regenerates the date).
-- occurrenceDate is immutable; dueDate can be rescheduled, so it is not the key.
CREATE UNIQUE INDEX "scheduled_expense_payments_occurrence_key" ON "scheduled_expense_payments"("templateId", "occurrenceDate")
  WHERE "templateId" IS NOT NULL AND "status" <> 'CANCELLED';
-- At most one current (CONFIRMED) expense pays a scheduled payment; voided ones stay as history.
CREATE UNIQUE INDEX "expenses_scheduledPaymentId_confirmed_key" ON "expenses"("scheduledPaymentId")
  WHERE "scheduledPaymentId" IS NOT NULL AND "status" = 'CONFIRMED';

ALTER TABLE "scheduled_expense_payments" ADD CONSTRAINT "scheduled_expense_payments_valid_check" CHECK (
  ("plannedAmount" IS NULL OR ("plannedAmount" > 0 AND "plannedAmount" <= 1000000000000))
  AND (("paymentMethod" = 'OTHER') = ("paymentMethodNote" IS NOT NULL))
  AND ("paymentMethodNote" IS NULL OR length(btrim("paymentMethodNote")) BETWEEN 3 AND 80)
  AND length(btrim("description")) BETWEEN 1 AND 300
  AND ("supplierName" IS NULL OR length(btrim("supplierName")) BETWEEN 1 AND 160)
  AND ("cancelReason" IS NULL OR length(btrim("cancelReason")) BETWEEN 1 AND 300)
  AND "dueDate" >= DATE '2000-01-01'
  AND (("templateId" IS NULL) = ("occurrenceDate" IS NULL))
  AND "version" > 0);
ALTER TABLE "scheduled_expense_payments" ADD CONSTRAINT "scheduled_expense_payments_status_check" CHECK (
     ("status" = 'PENDING' AND "paidExpenseId" IS NULL AND "paidAt" IS NULL AND "cancelledAt" IS NULL AND "cancelReason" IS NULL)
  OR ("status" = 'PAID' AND "paidExpenseId" IS NOT NULL AND "paidAt" IS NOT NULL AND "cancelledAt" IS NULL AND "cancelReason" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "paidExpenseId" IS NULL AND "paidAt" IS NULL));
-- Expenses created by paying keep source MANUAL; the link is scheduledPaymentId (F1a's source rules unchanged).
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_scheduled_source_check" CHECK ("scheduledPaymentId" IS NULL OR "source" = 'MANUAL');

-- Identity columns frozen and no deletes (F1a's guard function).
CREATE TRIGGER scheduled_expense_payments_identity_guard BEFORE UPDATE OR DELETE ON "scheduled_expense_payments"
  FOR EACH ROW EXECUTE FUNCTION expense_row_guard('id', 'ownerId', 'templateId', 'occurrenceDate', 'createdAt');

-- Transitions: PENDING -> PENDING (edit) | PAID | CANCELLED; PAID -> PAID (replacement) | PENDING (voided, decision F1b-1);
-- CANCELLED is terminal. Each transition may only change its own columns.
CREATE FUNCTION scheduled_payment_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed TEXT[]; allowed TEXT[];
BEGIN
  changed := ARRAY(SELECT n.key FROM jsonb_each(to_jsonb(NEW)) n WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key);
  IF OLD."status" = 'CANCELLED' THEN RAISE EXCEPTION 'INVALID_SCHEDULED_TRANSITION' USING ERRCODE = '23514'; END IF;
  allowed := CASE
    WHEN OLD."status" = 'PENDING' AND NEW."status" = 'PENDING' THEN ARRAY['dueDate', 'plannedAmount', 'description', 'categoryId', 'categoryNameSnapshot', 'paymentMethod',
      'paymentMethodNote', 'supplierName', 'customizedAt', 'version', 'updatedAt']
    WHEN OLD."status" = 'PENDING' AND NEW."status" = 'PAID' THEN ARRAY['status', 'paidExpenseId', 'paidAt', 'version', 'updatedAt']
    WHEN OLD."status" = 'PENDING' AND NEW."status" = 'CANCELLED' THEN ARRAY['status', 'cancelledAt', 'cancelReason', 'version', 'updatedAt']
    WHEN OLD."status" = 'PAID' AND NEW."status" = 'PAID' THEN ARRAY['paidExpenseId', 'paidAt', 'version', 'updatedAt']
    WHEN OLD."status" = 'PAID' AND NEW."status" = 'PENDING' THEN ARRAY['status', 'paidExpenseId', 'paidAt', 'version', 'updatedAt']
    ELSE NULL END;
  IF allowed IS NULL OR NOT (changed <@ allowed) THEN RAISE EXCEPTION 'INVALID_SCHEDULED_TRANSITION' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scheduled_expense_payments_transition_guard BEFORE UPDATE ON "scheduled_expense_payments"
  FOR EACH ROW EXECUTE FUNCTION scheduled_payment_transition_guard();

-- Coherence, checked at commit: PAID <=> exactly one CONFIRMED expense links to it and it is paidExpenseId.
CREATE FUNCTION scheduled_payment_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT; payment RECORD; current_count INTEGER;
BEGIN
  -- Read through jsonb: the record type differs per table and plpgsql would reject the missing field.
  pid := CASE WHEN TG_TABLE_NAME = 'expenses' THEN to_jsonb(NEW) ->> 'scheduledPaymentId' ELSE to_jsonb(NEW) ->> 'id' END;
  IF pid IS NULL THEN RETURN NULL; END IF;
  SELECT "status", "paidExpenseId" INTO payment FROM "scheduled_expense_payments" WHERE "id" = pid;
  SELECT count(*) INTO current_count FROM "expenses" WHERE "scheduledPaymentId" = pid AND "status" = 'CONFIRMED';
  IF payment."status" = 'PAID' THEN
    IF current_count <> 1 OR NOT EXISTS (SELECT 1 FROM "expenses" WHERE "id" = payment."paidExpenseId" AND "scheduledPaymentId" = pid AND "status" = 'CONFIRMED') THEN
      RAISE EXCEPTION 'SCHEDULED_PAYMENT_INCOHERENT' USING ERRCODE = '23514';
    END IF;
  ELSIF current_count <> 0 THEN
    RAISE EXCEPTION 'SCHEDULED_PAYMENT_INCOHERENT' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scheduled_expense_payments_coherence AFTER INSERT OR UPDATE ON "scheduled_expense_payments"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION scheduled_payment_coherence();
CREATE CONSTRAINT TRIGGER expenses_scheduled_payment_coherence AFTER INSERT OR UPDATE ON "expenses"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."scheduledPaymentId" IS NOT NULL) EXECUTE FUNCTION scheduled_payment_coherence();

COMMIT;
