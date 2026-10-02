CREATE TYPE "CatalogTemplate" AS ENUM ('EDITORIAL', 'GRID', 'BOUTIQUE');

ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

ALTER TABLE "catalogs" ADD COLUMN "publicId" TEXT;
ALTER TABLE "catalogs" ADD COLUMN "whatsappPhone" TEXT;
ALTER TABLE "catalogs" ADD COLUMN "template" "CatalogTemplate" NOT NULL DEFAULT 'EDITORIAL';
UPDATE "catalogs" SET "publicId" = gen_random_uuid()::text WHERE "publicId" IS NULL;
ALTER TABLE "catalogs" ALTER COLUMN "publicId" SET NOT NULL;
CREATE UNIQUE INDEX "catalogs_publicId_key" ON "catalogs"("publicId");

ALTER TABLE "orders" ADD COLUMN "customerConsentAt" TIMESTAMP(3);