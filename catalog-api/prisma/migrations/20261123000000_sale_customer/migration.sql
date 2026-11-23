-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "customerEmailSnapshot" VARCHAR(254),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerNameSnapshot" VARCHAR(160),
ADD COLUMN     "customerPhoneSnapshot" VARCHAR(15);

-- CreateIndex
CREATE INDEX "Sale_customerId_userId_idx" ON "Sale"("customerId", "userId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_userId_fkey" FOREIGN KEY ("customerId", "userId") REFERENCES "customers"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
