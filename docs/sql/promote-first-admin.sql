-- Manual only. Replace the UUID placeholder after confirming the account owner.
-- Run after the UserRole migration, on the explicitly approved database.
BEGIN;

-- Serialize simultaneous attempts at creating the first administrator.
LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  affected INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "role" = 'ADMIN'::"UserRole") THEN
    RAISE EXCEPTION 'Ya existe un administrador; revisar antes de continuar';
  END IF;

  UPDATE "users"
  SET "role" = 'ADMIN'::"UserRole", "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = 'REEMPLAZAR_POR_UUID_CONFIRMADO'
    AND "role" = 'USER'::"UserRole";

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Debe actualizarse exactamente una cuenta';
  END IF;
END $$;

COMMIT;
