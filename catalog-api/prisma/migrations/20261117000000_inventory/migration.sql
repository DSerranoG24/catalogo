CREATE TABLE "inventory_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0 CHECK ("stock" >= 0),
  "minimumStock" INTEGER NOT NULL DEFAULT 0 CHECK ("minimumStock" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "inventory_items_userId_sku_key" ON "inventory_items"("userId", "sku");
CREATE INDEX "inventory_items_userId_createdAt_idx" ON "inventory_items"("userId", "createdAt");
CREATE TABLE "inventory_movements" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "itemId" TEXT NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('IN', 'OUT', 'ADJUSTMENT')),
  "quantity" INTEGER NOT NULL CHECK ("quantity" >= 0),
  "previousStock" INTEGER NOT NULL CHECK ("previousStock" >= 0),
  "resultingStock" INTEGER NOT NULL CHECK ("resultingStock" >= 0),
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "inventory_movements_itemId_key_key" ON "inventory_movements"("itemId", "key");
CREATE INDEX "inventory_movements_itemId_createdAt_idx" ON "inventory_movements"("itemId", "createdAt");
