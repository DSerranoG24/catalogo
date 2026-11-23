-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "order_customer_operations" (
    "ownerId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "associatedSaleId" TEXT,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_customer_operations_pkey" PRIMARY KEY ("ownerId","operationId")
);

-- CreateIndex
CREATE INDEX "order_customer_operations_orderId_idx" ON "order_customer_operations"("orderId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_customer_operations" ADD CONSTRAINT "order_customer_operations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_customer_operations" ADD CONSTRAINT "order_customer_operations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_customer_operations" ADD CONSTRAINT "order_customer_operations_customerId_ownerId_fkey" FOREIGN KEY ("customerId", "ownerId") REFERENCES "customers"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
