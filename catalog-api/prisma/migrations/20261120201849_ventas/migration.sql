/*
  Warnings:

  - The `saleMovementRole` column on the `inventory_movements` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "SaleMovementRole" AS ENUM ('SALE_CONFIRMATION', 'SALE_CANCELLATION', 'SALE_RETURN_RESELLABLE', 'SALE_RETURN_DAMAGED');

-- AlterTable
ALTER TABLE "inventory_movements" DROP COLUMN "saleMovementRole",
ADD COLUMN     "saleMovementRole" "SaleMovementRole";

-- CreateIndex
CREATE INDEX "inventory_movements_saleId_saleMovementRole_createdAt_idx" ON "inventory_movements"("saleId", "saleMovementRole", "createdAt");
