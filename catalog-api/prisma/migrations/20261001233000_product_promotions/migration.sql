ALTER TABLE "products"
ADD COLUMN "salePrice" INTEGER,
ADD COLUMN "saleStartsAt" TIMESTAMP(3),
ADD COLUMN "saleEndsAt" TIMESTAMP(3);

ALTER TABLE "products"
ADD CONSTRAINT "products_promotion_valid_check"
CHECK (
  ("salePrice" IS NULL AND "saleStartsAt" IS NULL AND "saleEndsAt" IS NULL)
  OR (
    "salePrice" IS NOT NULL
    AND "salePrice" >= 0
    AND "salePrice" < "price"
    AND "saleStartsAt" IS NOT NULL
    AND "saleEndsAt" IS NOT NULL
    AND "saleStartsAt" < "saleEndsAt"
  )
);