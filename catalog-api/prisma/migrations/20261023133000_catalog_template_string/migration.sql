ALTER TABLE "catalogs" ALTER COLUMN "template" DROP DEFAULT;
ALTER TABLE "catalogs"
  ALTER COLUMN "template" TYPE TEXT
  USING "template"::TEXT;
DROP TYPE "CatalogTemplate";
ALTER TABLE "catalogs" ALTER COLUMN "template" SET DEFAULT 'EDITORIAL';
