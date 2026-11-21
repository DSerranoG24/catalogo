/*
  Warnings:

  - A unique constraint covering the columns `[sourceOrderId]` on the table `Sale` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "sourceOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_sourceOrderId_key" ON "Sale"("sourceOrderId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
