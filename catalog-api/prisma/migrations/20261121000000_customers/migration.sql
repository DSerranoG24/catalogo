-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(254),
    "address" VARCHAR(300),
    "notes" VARCHAR(2000),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_ownerId_phone_idx" ON "customers"("ownerId", "phone");

-- CreateIndex
CREATE INDEX "customers_ownerId_archivedAt_createdAt_id_idx" ON "customers"("ownerId", "archivedAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_ownerId_key" ON "customers"("id", "ownerId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
