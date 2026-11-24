BEGIN;
-- CreateEnum
CREATE TYPE "CompatibilityStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CompatibilityEvidenceType" AS ENUM ('SELLER_TEST', 'MANUFACTURER_REFERENCE', 'SUPPLIER_REFERENCE', 'DOCUMENTED_REVIEW');

-- CreateTable
CREATE TABLE "device_brands" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "device_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_brand_names" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "normalizedKey" VARCHAR(320) NOT NULL,
    "normalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "isCanonical" BOOLEAN NOT NULL DEFAULT false,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_brand_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_models" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "manufacturerCode" VARCHAR(100),
    "manufacturerCodeKey" VARCHAR(320),
    "version" INTEGER NOT NULL DEFAULT 1,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "device_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_model_names" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "normalizedKey" VARCHAR(320) NOT NULL,
    "normalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "isCanonical" BOOLEAN NOT NULL DEFAULT false,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_model_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compatibility_sets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INVENTORY_ITEM',
    "inventoryItemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "compatibility_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_compatibilities" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" "CompatibilityStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "evidenceType" "CompatibilityEvidenceType",
    "evidenceReference" VARCHAR(500),
    "note" VARCHAR(1000),
    "reviewReason" VARCHAR(500),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "item_compatibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compatibility_operations" (
    "ownerId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "resourceKind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compatibility_operations_pkey" PRIMARY KEY ("ownerId","operationId")
);

-- CreateTable
CREATE TABLE "compatibility_events" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "setId" TEXT,
    "entityKind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compatibility_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_brands_ownerId_id_idx" ON "device_brands"("ownerId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "device_brands_id_ownerId_key" ON "device_brands"("id", "ownerId");

-- CreateIndex
CREATE INDEX "device_brand_names_ownerId_brandId_id_idx" ON "device_brand_names"("ownerId", "brandId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "device_brand_names_ownerId_normalizedKey_key" ON "device_brand_names"("ownerId", "normalizedKey");

-- CreateIndex
CREATE INDEX "device_models_ownerId_brandId_id_idx" ON "device_models"("ownerId", "brandId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "device_models_id_ownerId_key" ON "device_models"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "device_models_id_ownerId_brandId_key" ON "device_models"("id", "ownerId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "device_models_ownerId_brandId_manufacturerCodeKey_key" ON "device_models"("ownerId", "brandId", "manufacturerCodeKey");

-- CreateIndex
CREATE INDEX "device_model_names_ownerId_modelId_id_idx" ON "device_model_names"("ownerId", "modelId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "device_model_names_ownerId_brandId_normalizedKey_key" ON "device_model_names"("ownerId", "brandId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "compatibility_sets_inventoryItemId_key" ON "compatibility_sets"("inventoryItemId");

-- CreateIndex
CREATE INDEX "compatibility_sets_ownerId_inventoryItemId_idx" ON "compatibility_sets"("ownerId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "compatibility_sets_id_ownerId_key" ON "compatibility_sets"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "compatibility_sets_inventoryItemId_ownerId_key" ON "compatibility_sets"("inventoryItemId", "ownerId");

-- CreateIndex
CREATE INDEX "item_compatibilities_ownerId_modelId_status_setId_idx" ON "item_compatibilities"("ownerId", "modelId", "status", "setId");

-- CreateIndex
CREATE INDEX "item_compatibilities_ownerId_setId_status_id_idx" ON "item_compatibilities"("ownerId", "setId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_compatibilities_id_ownerId_key" ON "item_compatibilities"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "item_compatibilities_setId_modelId_key" ON "item_compatibilities"("setId", "modelId");

-- CreateIndex
CREATE INDEX "compatibility_events_ownerId_entityKind_entityId_occurredAt_idx" ON "compatibility_events"("ownerId", "entityKind", "entityId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "compatibility_events_ownerId_setId_occurredAt_id_idx" ON "compatibility_events"("ownerId", "setId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compatibility_events_ownerId_operationId_entityKind_entityI_key" ON "compatibility_events"("ownerId", "operationId", "entityKind", "entityId");

-- AddForeignKey
ALTER TABLE "device_brands" ADD CONSTRAINT "device_brands_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_brands" ADD CONSTRAINT "device_brands_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_brands" ADD CONSTRAINT "device_brands_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_brand_names" ADD CONSTRAINT "device_brand_names_brandId_ownerId_fkey" FOREIGN KEY ("brandId", "ownerId") REFERENCES "device_brands"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_brandId_ownerId_fkey" FOREIGN KEY ("brandId", "ownerId") REFERENCES "device_brands"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_models" ADD CONSTRAINT "device_models_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_model_names" ADD CONSTRAINT "device_model_names_modelId_ownerId_brandId_fkey" FOREIGN KEY ("modelId", "ownerId", "brandId") REFERENCES "device_models"("id", "ownerId", "brandId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "compatibility_sets" ADD CONSTRAINT "compatibility_sets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_sets" ADD CONSTRAINT "compatibility_sets_inventoryItemId_ownerId_fkey" FOREIGN KEY ("inventoryItemId", "ownerId") REFERENCES "inventory_items"("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "compatibility_sets" ADD CONSTRAINT "compatibility_sets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_sets" ADD CONSTRAINT "compatibility_sets_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_compatibilities" ADD CONSTRAINT "item_compatibilities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_compatibilities" ADD CONSTRAINT "item_compatibilities_setId_ownerId_fkey" FOREIGN KEY ("setId", "ownerId") REFERENCES "compatibility_sets"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "item_compatibilities" ADD CONSTRAINT "item_compatibilities_modelId_ownerId_fkey" FOREIGN KEY ("modelId", "ownerId") REFERENCES "device_models"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "item_compatibilities" ADD CONSTRAINT "item_compatibilities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_compatibilities" ADD CONSTRAINT "item_compatibilities_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_compatibilities" ADD CONSTRAINT "item_compatibilities_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_operations" ADD CONSTRAINT "compatibility_operations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_events" ADD CONSTRAINT "compatibility_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_events" ADD CONSTRAINT "compatibility_events_ownerId_operationId_fkey" FOREIGN KEY ("ownerId", "operationId") REFERENCES "compatibility_operations"("ownerId", "operationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "compatibility_events" ADD CONSTRAINT "compatibility_events_setId_ownerId_fkey" FOREIGN KEY ("setId", "ownerId") REFERENCES "compatibility_sets"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "compatibility_events" ADD CONSTRAINT "compatibility_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Additional invariants not represented by Prisma 6. No backfill or existing-row changes.
CREATE UNIQUE INDEX device_brand_one_canonical ON device_brand_names("brandId") WHERE "isCanonical" AND "retiredAt" IS NULL;
CREATE UNIQUE INDEX device_model_one_canonical ON device_model_names("modelId") WHERE "isCanonical" AND "retiredAt" IS NULL;
ALTER TABLE compatibility_sets ADD CONSTRAINT compatibility_set_inventory_only CHECK (kind = 'INVENTORY_ITEM');
ALTER TABLE device_brand_names ADD CONSTRAINT device_brand_name_valid CHECK (length(btrim(label)) > 0 AND length(btrim("normalizedKey")) > 0 AND "normalizationVersion" = 1);
ALTER TABLE device_model_names ADD CONSTRAINT device_model_name_valid CHECK (length(btrim(label)) > 0 AND length(btrim("normalizedKey")) > 0 AND "normalizationVersion" = 1);
ALTER TABLE device_models ADD CONSTRAINT device_model_code_valid CHECK (("manufacturerCode" IS NULL AND "manufacturerCodeKey" IS NULL) OR ("manufacturerCode" IS NOT NULL AND "manufacturerCodeKey" IS NOT NULL AND length(btrim("manufacturerCode")) > 0 AND length(btrim("manufacturerCodeKey")) > 0));
ALTER TABLE item_compatibilities ADD CONSTRAINT compatibility_review_valid CHECK (
  (status = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "verifiedById" IS NOT NULL AND "verifiedById" = "ownerId" AND "evidenceType" IS NOT NULL AND (length(btrim(coalesce("evidenceReference",''))) > 0 OR length(btrim(coalesce(note,''))) > 0))
  OR (status <> 'VERIFIED' AND "verifiedAt" IS NULL AND "verifiedById" IS NULL)
);
ALTER TABLE item_compatibilities ADD CONSTRAINT compatibility_reason_valid CHECK (status NOT IN ('REJECTED','WITHDRAWN') OR length(btrim(coalesce("reviewReason",''))) >= 3);
ALTER TABLE compatibility_operations ADD CONSTRAINT compatibility_receipt_valid CHECK ("requestHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("responseSnapshot") = 'object');
ALTER TABLE compatibility_events ADD CONSTRAINT compatibility_event_valid CHECK ("actorId" = "ownerId" AND jsonb_typeof("after") = 'object' AND ("before" IS NULL OR jsonb_typeof("before") = 'object'));
ALTER TABLE device_brands ADD CONSTRAINT device_brands_version_actor CHECK (version > 0 AND "createdById" = "ownerId" AND "updatedById" = "ownerId");
ALTER TABLE device_models ADD CONSTRAINT device_models_version_actor CHECK (version > 0 AND "createdById" = "ownerId" AND "updatedById" = "ownerId");
ALTER TABLE compatibility_sets ADD CONSTRAINT compatibility_sets_version_actor CHECK (version > 0 AND "createdById" = "ownerId" AND "updatedById" = "ownerId");
ALTER TABLE item_compatibilities ADD CONSTRAINT item_compatibilities_version_actor CHECK (version > 0 AND "createdById" = "ownerId" AND "updatedById" = "ownerId");

CREATE FUNCTION compatibility_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'COMPATIBILITY_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER compatibility_receipt_immutable BEFORE UPDATE OR DELETE ON compatibility_operations FOR EACH ROW EXECUTE FUNCTION compatibility_immutable_history();
CREATE TRIGGER compatibility_event_immutable BEFORE UPDATE OR DELETE ON compatibility_events FOR EACH ROW EXECUTE FUNCTION compatibility_immutable_history();
CREATE FUNCTION compatibility_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMPATIBILITY_HISTORY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW)->field_name) IS DISTINCT FROM (to_jsonb(OLD)->field_name) THEN
      RAISE EXCEPTION 'COMPATIBILITY_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER device_brands_identity_guard BEFORE UPDATE OR DELETE ON device_brands FOR EACH ROW EXECUTE FUNCTION compatibility_identity_guard('id','ownerId','createdById','createdAt');
CREATE TRIGGER device_models_identity_guard BEFORE UPDATE OR DELETE ON device_models FOR EACH ROW EXECUTE FUNCTION compatibility_identity_guard('id','ownerId','brandId','manufacturerCode','manufacturerCodeKey','createdById','createdAt');
CREATE TRIGGER device_brand_names_identity_guard BEFORE UPDATE OR DELETE ON device_brand_names FOR EACH ROW EXECUTE FUNCTION compatibility_identity_guard('id','ownerId','brandId','normalizedKey','normalizationVersion','createdAt');
CREATE TRIGGER device_model_names_identity_guard BEFORE UPDATE OR DELETE ON device_model_names FOR EACH ROW EXECUTE FUNCTION compatibility_identity_guard('id','ownerId','brandId','modelId','normalizedKey','normalizationVersion','createdAt');
CREATE TRIGGER compatibility_sets_identity_guard BEFORE UPDATE OR DELETE ON compatibility_sets FOR EACH ROW EXECUTE FUNCTION compatibility_identity_guard('id','ownerId','inventoryItemId','kind','createdById','createdAt');
CREATE TRIGGER item_compatibilities_identity_guard BEFORE UPDATE OR DELETE ON item_compatibilities FOR EACH ROW EXECUTE FUNCTION compatibility_identity_guard('id','ownerId','setId','modelId','createdById','createdAt');

-- Deferred until commit, so the header and its canonical name are inserted atomically.
CREATE FUNCTION compatibility_canonical_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_id TEXT; entity_owner TEXT; n BIGINT;
BEGIN
  entity_owner := NEW."ownerId";
  IF TG_TABLE_NAME IN ('device_brands','device_brand_names') THEN
    IF TG_TABLE_NAME = 'device_brands' THEN entity_id := NEW.id; ELSE entity_id := NEW."brandId"; END IF;
    IF EXISTS (SELECT 1 FROM device_brands WHERE id=entity_id AND "ownerId"=entity_owner AND "retiredAt" IS NULL) THEN
      SELECT count(*) INTO n FROM device_brand_names WHERE "brandId"=entity_id AND "ownerId"=entity_owner AND "isCanonical" AND "retiredAt" IS NULL;
      IF n <> 1 THEN RAISE EXCEPTION 'DEVICE_CANONICAL_REQUIRED' USING ERRCODE = '23514'; END IF;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'device_models' THEN entity_id := NEW.id; ELSE entity_id := NEW."modelId"; END IF;
    IF EXISTS (SELECT 1 FROM device_models WHERE id=entity_id AND "ownerId"=entity_owner AND "retiredAt" IS NULL) THEN
      SELECT count(*) INTO n FROM device_model_names WHERE "modelId"=entity_id AND "ownerId"=entity_owner AND "isCanonical" AND "retiredAt" IS NULL;
      IF n <> 1 THEN RAISE EXCEPTION 'DEVICE_CANONICAL_REQUIRED' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER device_brands_canonical_guard AFTER INSERT OR UPDATE ON device_brands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION compatibility_canonical_guard();
CREATE CONSTRAINT TRIGGER device_brand_names_canonical_guard AFTER INSERT OR UPDATE ON device_brand_names DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION compatibility_canonical_guard();
CREATE CONSTRAINT TRIGGER device_models_canonical_guard AFTER INSERT OR UPDATE ON device_models DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION compatibility_canonical_guard();
CREATE CONSTRAINT TRIGGER device_model_names_canonical_guard AFTER INSERT OR UPDATE ON device_model_names DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION compatibility_canonical_guard();

COMMIT;
