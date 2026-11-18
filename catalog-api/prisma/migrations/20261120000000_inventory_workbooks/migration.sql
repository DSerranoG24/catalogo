BEGIN;
CREATE TABLE inventory_workbooks (
  "userId" TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  snapshot TEXT NOT NULL CHECK (octet_length(snapshot) <= 2097152),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE inventory_workbook_saves (
  "userId" TEXT NOT NULL REFERENCES inventory_workbooks("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operationId" TEXT NOT NULL, hash TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "operationId")
);
COMMIT;
