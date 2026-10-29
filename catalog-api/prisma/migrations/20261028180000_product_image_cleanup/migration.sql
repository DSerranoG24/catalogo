-- Independent queue: intentionally no foreign keys to products or catalogs.
CREATE TABLE "product_image_cleanup_tasks" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "bucket" TEXT NOT NULL DEFAULT 'product-images',
  "catalogId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_image_cleanup_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_image_cleanup_tasks_state_check" CHECK ("state" = 'PENDING'),
  CONSTRAINT "product_image_cleanup_tasks_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "product_image_cleanup_tasks_bucket_check" CHECK ("bucket" = 'product-images')
);
CREATE UNIQUE INDEX "product_image_cleanup_tasks_bucket_path_key" ON "product_image_cleanup_tasks"("bucket", "path");
CREATE INDEX "product_image_cleanup_tasks_state_nextAttemptAt_idx" ON "product_image_cleanup_tasks"("state", "nextAttemptAt");
