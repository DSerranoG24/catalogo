ALTER TABLE "catalogs"
  ADD COLUMN "nit" TEXT,
  ADD COLUMN "quotationTerms" TEXT,
  ADD COLUMN "quotationCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN "quotationNumber" INTEGER,
  ADD COLUMN "quotationIssuedAt" TIMESTAMP(3),
  ADD COLUMN "quotationSellerSnapshot" JSONB,
  ADD COLUMN "quotationToken" TEXT;

CREATE UNIQUE INDEX "orders_catalogId_quotationNumber_key"
  ON "orders"("catalogId", "quotationNumber");
CREATE UNIQUE INDEX "orders_quotationToken_key" ON "orders"("quotationToken");

ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_quotationCounter_check"
  CHECK ("quotationCounter" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotationNumber_check"
  CHECK ("quotationNumber" IS NULL OR "quotationNumber" > 0);
