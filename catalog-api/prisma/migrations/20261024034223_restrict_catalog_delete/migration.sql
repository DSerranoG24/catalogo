-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_catalogId_fkey";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
