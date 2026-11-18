BEGIN;
ALTER TABLE inventory_items ADD COLUMN "dataVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "stockVersion" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "inventory_items_id_userId_key" ON inventory_items(id, "userId");
CREATE TABLE item_commercial_terms (
  "itemId" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  "unitSalePrice" BIGINT NOT NULL CHECK ("unitSalePrice" >= 0), "referenceUnitCost" BIGINT CHECK ("referenceUnitCost" >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "item_commercial_terms_itemId_userId_fkey" FOREIGN KEY ("itemId", "userId") REFERENCES inventory_items(id, "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "item_commercial_terms_userId_idx" ON item_commercial_terms("userId");
CREATE UNIQUE INDEX "item_commercial_terms_itemId_userId_key" ON item_commercial_terms("itemId","userId");
CREATE TABLE inventory_batches (
  id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('GRID','PASTE','XLSX','CSV')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','INVALID','READY','STALE','APPLIED','CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0), "previewRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("previewRevision" >= 0),
  "totalRows" INTEGER NOT NULL CHECK ("totalRows" BETWEEN 1 AND 500), reason TEXT,
  "inputHash" TEXT, "planHash" TEXT, "applyOperationId" TEXT, "previewExpiresAt" TIMESTAMP(3), plan JSONB, receipt JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (status <> 'APPLIED' OR (receipt IS NOT NULL AND "applyOperationId" IS NOT NULL))
);
CREATE UNIQUE INDEX "inventory_batches_applyOperationId_key" ON inventory_batches("applyOperationId");
CREATE INDEX "inventory_batches_userId_createdAt_id_idx" ON inventory_batches("userId","createdAt",id);
CREATE TABLE inventory_batch_rows (
  "batchId" TEXT NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "rowId" TEXT NOT NULL, "rowNumber" INTEGER NOT NULL CHECK ("rowNumber" BETWEEN 2 AND 1048576),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0), "reservedItemId" TEXT NOT NULL, excluded BOOLEAN NOT NULL DEFAULT false,
  "values" JSONB NOT NULL, PRIMARY KEY ("batchId","rowId")
);
CREATE UNIQUE INDEX "inventory_batch_rows_batchId_rowNumber_key" ON inventory_batch_rows("batchId","rowNumber");
CREATE TABLE inventory_batch_chunk_receipts (
  "batchId" TEXT NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "chunkId" TEXT NOT NULL, hash TEXT NOT NULL, result JSONB NOT NULL, PRIMARY KEY ("batchId","chunkId")
);
ALTER TABLE inventory_movements ADD COLUMN delta INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "actorUserId" TEXT REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'MANUAL' CHECK (origin IN ('MANUAL','INVENTORY_BATCH')),
  ADD COLUMN "batchId" TEXT, ADD COLUMN "batchRowId" TEXT, ADD COLUMN "batchOperationId" TEXT,
  ADD CONSTRAINT "inventory_movements_batchId_batchRowId_fkey" FOREIGN KEY ("batchId","batchRowId") REFERENCES inventory_batch_rows("batchId","rowId") ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE inventory_movements SET delta = "resultingStock" - "previousStock";
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_delta_check CHECK (delta = "resultingStock" - "previousStock"),
  ADD CONSTRAINT inventory_movements_batch_check CHECK (
    (origin = 'MANUAL' AND "batchId" IS NULL AND "batchRowId" IS NULL AND "batchOperationId" IS NULL)
    OR (origin = 'INVENTORY_BATCH' AND "batchId" IS NOT NULL AND "batchRowId" IS NOT NULL AND "batchOperationId" IS NOT NULL AND "actorUserId" IS NOT NULL)
  );
CREATE UNIQUE INDEX "inventory_movements_batchOperationId_itemId_key" ON inventory_movements("batchOperationId","itemId");
CREATE FUNCTION inventory_versions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."dataVersion" := OLD."dataVersion" + CASE WHEN (NEW.name,NEW.sku,NEW."minimumStock") IS DISTINCT FROM (OLD.name,OLD.sku,OLD."minimumStock") THEN 1 ELSE 0 END;
  NEW."stockVersion" := OLD."stockVersion" + CASE WHEN NEW.stock IS DISTINCT FROM OLD.stock OR NEW."stockVersion" IS DISTINCT FROM OLD."stockVersion" THEN 1 ELSE 0 END;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_versions BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_versions();
CREATE FUNCTION inventory_terms_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW.version := OLD.version + CASE WHEN (NEW.currency,NEW."unitSalePrice",NEW."referenceUnitCost") IS DISTINCT FROM (OLD.currency,OLD."unitSalePrice",OLD."referenceUnitCost") THEN 1 ELSE 0 END;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_terms_version BEFORE UPDATE ON item_commercial_terms FOR EACH ROW EXECUTE FUNCTION inventory_terms_version();
CREATE FUNCTION inventory_movement_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_owner TEXT; item_owner TEXT; operation_id TEXT;
BEGIN
  NEW.delta := NEW."resultingStock" - NEW."previousStock";
  IF NEW.origin = 'INVENTORY_BATCH' THEN
    SELECT "userId", "applyOperationId" INTO batch_owner, operation_id FROM inventory_batches WHERE id = NEW."batchId";
    SELECT "userId" INTO item_owner FROM inventory_items WHERE id = NEW."itemId";
    IF batch_owner IS DISTINCT FROM item_owner OR NEW."actorUserId" IS DISTINCT FROM batch_owner OR NEW."batchOperationId" IS DISTINCT FROM operation_id THEN
      RAISE EXCEPTION 'INVALID_INVENTORY_OWNER' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_movement_audit BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_movement_audit();
CREATE FUNCTION inventory_immutable_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'INVENTORY_LEDGER_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER inventory_immutable_movement BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_immutable_movement();
COMMIT;
