ALTER TABLE "orders" ADD COLUMN "firstConfirmedAt" TIMESTAMP(3);

CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");
