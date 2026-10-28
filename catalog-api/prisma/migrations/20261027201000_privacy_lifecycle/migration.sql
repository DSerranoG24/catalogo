ALTER TABLE "users" ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE TABLE "order_deletion_markers" (
  "catalogId" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  CONSTRAINT "order_deletion_markers_pkey" PRIMARY KEY ("catalogId", "keyHash"),
  CONSTRAINT "order_deletion_markers_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_deletion_markers_hash_check" CHECK ("keyHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "account_closure_jobs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "catalogIds" TEXT[] NOT NULL,
  "pendingPaths" TEXT[] NOT NULL,
  "scanQueue" TEXT[] NOT NULL,
  "scanOffset" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_closure_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_closure_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "account_closure_jobs_phase_check" CHECK ("phase" IN ('PENDING', 'CLEANING', 'COMPLETE'))
);
CREATE UNIQUE INDEX "account_closure_jobs_userId_key" ON "account_closure_jobs"("userId");

-- Serialize writes with account closure, including requests authenticated before closure.
-- The worker only deletes dependent rows; ordinary inserts/updates stay blocked forever.
CREATE FUNCTION guard_closed_catalog_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_id TEXT; owner_id TEXT; row_data RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  IF current_setting('app.account_closure_worker', true) = 'on' THEN RETURN row_data; END IF;
  IF TG_TABLE_NAME = 'catalogs' THEN
    catalog_id := row_data.id;
    owner_id := row_data."userId";
  ELSIF TG_TABLE_NAME IN ('products', 'categories', 'orders', 'catalog_banners') THEN
    catalog_id := row_data."catalogId";
  ELSIF TG_TABLE_NAME IN ('product_images', 'product_reviews') THEN
    SELECT "catalogId" INTO catalog_id FROM products WHERE id = row_data."productId";
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    SELECT "catalogId" INTO catalog_id FROM orders WHERE id = row_data."orderId";
  END IF;
  IF owner_id IS NULL THEN
    SELECT "userId" INTO owner_id FROM catalogs WHERE id = catalog_id FOR SHARE;
  END IF;
  -- User lock also prevents creation of a new catalog during closure.
  PERFORM id FROM users WHERE id = owner_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM account_closure_jobs WHERE "userId" = owner_id) THEN
    RAISE EXCEPTION 'ACCOUNT_CLOSED' USING ERRCODE = '23514';
  END IF;
  RETURN row_data;
END;
$$;

CREATE TRIGGER catalogs_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON catalogs FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER products_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER categories_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON categories FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER orders_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER catalog_banners_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog_banners FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER product_images_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON product_images FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER product_reviews_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON product_reviews FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
CREATE TRIGGER order_items_privacy_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION guard_closed_catalog_write();
