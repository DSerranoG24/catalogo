ALTER TABLE "products" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "catalog_banners" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "linkType" TEXT NOT NULL,
    "linkValue" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_banners_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_banners_catalogId_fkey" FOREIGN KEY ("catalogId")
        REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "catalog_banners_linkType_check" CHECK ("linkType" IN ('PRODUCT', 'CATEGORY', 'EXTERNAL')),
    CONSTRAINT "catalog_banners_position_check" CHECK ("position" BETWEEN 0 AND 2),
    -- Deferred uniqueness allows swapping positions atomically without temporary invalid slots.
    CONSTRAINT "catalog_banners_catalogId_position_key" UNIQUE ("catalogId", "position") DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX "catalog_banners_catalogId_position_idx" ON "catalog_banners"("catalogId", "position");
