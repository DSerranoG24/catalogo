/*
  Warnings:

  - A unique constraint covering the columns `[id,userId]` on the table `catalogs` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,catalogId]` on the table `products` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "InventoryPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateTable
CREATE TABLE "InventoryItemImage" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryPublication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "InventoryPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "titleOverride" TEXT,
    "descriptionOverride" TEXT,
    "priceOverride" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItemImage_inventoryItemId_isPrimary_position_idx" ON "InventoryItemImage"("inventoryItemId", "isPrimary", "position");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItemImage_inventoryItemId_storagePath_key" ON "InventoryItemImage"("inventoryItemId", "storagePath");

-- CreateIndex
CREATE INDEX "InventoryPublication_userId_status_updatedAt_idx" ON "InventoryPublication"("userId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPublication_catalogId_inventoryItemId_key" ON "InventoryPublication"("catalogId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPublication_productId_key" ON "InventoryPublication"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPublication_productId_catalogId_key" ON "InventoryPublication"("productId", "catalogId");

-- CreateIndex
CREATE UNIQUE INDEX "catalogs_id_userId_key" ON "catalogs"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_catalogId_key" ON "products"("id", "catalogId");

-- AddForeignKey
ALTER TABLE "InventoryItemImage" ADD CONSTRAINT "InventoryItemImage_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPublication" ADD CONSTRAINT "InventoryPublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPublication" ADD CONSTRAINT "InventoryPublication_inventoryItemId_userId_fkey" FOREIGN KEY ("inventoryItemId", "userId") REFERENCES "inventory_items"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPublication" ADD CONSTRAINT "InventoryPublication_catalogId_userId_fkey" FOREIGN KEY ("catalogId", "userId") REFERENCES "catalogs"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryPublication" ADD CONSTRAINT "InventoryPublication_productId_catalogId_fkey" FOREIGN KEY ("productId", "catalogId") REFERENCES "products"("id", "catalogId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
