ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "orders_catalogId_idempotencyKey_key"
ON "orders"("catalogId", "idempotencyKey");
