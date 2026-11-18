import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdtemp, mkdir, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createInventory, inventoryHistory, listInventory, moveInventory } from "../repositories/inventory.repository";

const requireModule = createRequire(__filename);
const schema = `inventory_verify_${randomBytes(8).toString("hex")}`;
const migrationNames = ["20261117000000_inventory", "20261118000000_inventory_movement_consistency"];
let stage = "TARGET_GUARD";
let db: PrismaClient | undefined;
const passed: string[] = [];
function pass(name: string) { passed.push(name); console.log(`PASS ${name}`); }

export async function inventoryTestTarget(value: string) {
  const target = new URL(value.trim());
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test"); assert.equal(target.hash, "");
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  const addresses = await lookup(host, { all: true });
  assert.ok(addresses.length && addresses.every(value => value.address === "127.0.0.1" || value.address === "::1"));
  return target;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length < 8192); }
  const target = await inventoryTestTarget(input); input = "";
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connect_timeout", "5");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  pass(stage);
  db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const database = db;
  stage = "LOCAL_DATABASE_IDENTITY";
  const [identity] = await database.$queryRaw<{ database: string; address: string }[]>`SELECT current_database() AS database, host(inet_server_addr()) AS address`;
  assert.equal(identity?.database, "catalogo_test");
  assert.ok(identity.address === "127.0.0.1" || identity.address === "::1");
  await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await database.$disconnect();
  const [namespace] = await database.$queryRaw<{ name: string }[]>`SELECT current_schema() AS name`;
  assert.equal(namespace?.name, schema); pass(stage);

  const folder = await mkdtemp(path.join(tmpdir(), "inventory-migrations-"));
  const migrationRoot = path.resolve("prisma/migrations");
  const names = (await readdir(migrationRoot, { withFileTypes: true })).filter(value => value.isDirectory()).map(value => value.name).sort();
  const inventoryStart = names.indexOf(migrationNames[0]);
  assert.ok(inventoryStart >= 0); assert.deepEqual(names.slice(inventoryStart, inventoryStart + 2), migrationNames);
  await mkdir(path.join(folder, "migrations"));
  await cp("prisma/schema.prisma", path.join(folder, "schema.prisma"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(folder, "migrations/migration_lock.toml"));
  for (const name of names.slice(0, inventoryStart)) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  function deploy() {
    const result = spawnSync(process.execPath, [requireModule.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(folder, "schema.prisma")], {
      cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 60000, windowsHide: true,
    });
    // Never echo Prisma output: it may contain connection details.
    assert.equal(result.status, 0, "MIGRATION_DEPLOY_FAILED");
  }
  stage = "BASELINE_MIGRATIONS"; deploy(); pass(stage);
  const owner = await database.user.create({ data: { email: `inventory_${randomUUID()}@example.invalid` } });
  const other = await database.user.create({ data: { email: `inventory_${randomUUID()}@example.invalid` } });
  const catalog = await database.catalog.create({ data: { userId: owner.id, name: "Existing test catalog", slug: "existing" } });
  const product = await database.product.create({ data: { catalogId: catalog.id, name: "Existing test product", slug: "existing", price: 100, stock: 7 } });
  stage = "INVENTORY_MIGRATION_OVER_EXISTING_DATA";
  await cp(path.join(migrationRoot, migrationNames[0]), path.join(folder, "migrations", migrationNames[0]), { recursive: true });
  deploy();
  assert.equal((await database.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 7); pass(stage);
  // The repository now requires the batch audit/version columns. The separate batch
  // rehearsal tests migration backfill over legacy inventory rows before loading it.
  for (const name of names.slice(inventoryStart + 1)) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  deploy();

  stage = "CREATE_CONCURRENCY_AND_SKU_ISOLATION";
  const itemInput = { id: randomUUID(), name: "Inventory test item", sku: "VERIFY-SKU", minimumStock: 2 };
  const creations = await Promise.all(Array.from({ length: 8 }, () => createInventory(owner.id, itemInput, database)));
  assert.ok(creations.every(value => value.id === itemInput.id));
  assert.equal(await database.inventoryItem.count({ where: { id: itemInput.id } }), 1);
  await assert.rejects(createInventory(owner.id, { ...itemInput, id: randomUUID() }, database));
  await assert.rejects(createInventory(other.id, itemInput, database));
  await assert.rejects(createInventory(owner.id, { ...itemInput, name: "Changed retry" }, database), /KEY_CONFLICT/);
  const otherItem = await createInventory(other.id, { ...itemInput, id: randomUUID() }, database);
  assert.equal(otherItem.sku, itemInput.sku); pass(stage);

  const opening = { key: randomUUID(), type: "IN" as const, quantity: 10, reason: "Opening test balance" };
  await moveInventory(owner.id, itemInput.id, opening, database);
  stage = "NEW_CONSTRAINT_OVER_EXISTING_MOVEMENTS";
  await cp(path.join(migrationRoot, migrationNames[1]), path.join(folder, "migrations", migrationNames[1]), { recursive: true }); deploy();
  assert.equal(await database.inventoryMovement.count({ where: { itemId: itemInput.id } }), 1);
  const constraints = await database.$queryRaw<{ conname: string; validated: boolean }[]>`SELECT conname, convalidated AS validated FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conrelid = 'inventory_movements'::regclass`;
  assert.ok(constraints.some(value => value.conname === "inventory_movements_balance_check" && value.validated));
  const columns = await database.$queryRaw<{ column_name: string; data_type: string }[]>`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'inventory_items'`;
  assert.ok(columns.some(value => value.column_name === "stock" && value.data_type === "integer"));
  const indexes = await database.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = ${schema} AND tablename IN ('inventory_items', 'inventory_movements')`;
  for (const name of ["inventory_items_userId_sku_key", "inventory_items_userId_createdAt_idx", "inventory_movements_itemId_key_key", "inventory_movements_itemId_createdAt_idx"]) assert.ok(indexes.some(value => value.indexname === name));
  pass(stage);

  stage = "CONCURRENT_EXITS_NEVER_NEGATIVE";
  const exits = await Promise.allSettled(Array.from({ length: 20 }, () => moveInventory(owner.id, itemInput.id, { key: randomUUID(), type: "OUT", quantity: 1, reason: "Concurrent test exit" }, database)));
  assert.equal(exits.filter(value => value.status === "fulfilled").length, 10);
  assert.ok(exits.every(value => value.status === "fulfilled" || (value.reason instanceof Error && value.reason.message === "INVALID_STOCK")));
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: itemInput.id } })).stock, 0);
  assert.equal(await database.inventoryMovement.count({ where: { itemId: itemInput.id } }), 11); pass(stage);

  stage = "CONCURRENT_IDEMPOTENCY_AND_KEY_CONFLICT";
  const entry = { key: randomUUID(), type: "IN" as const, quantity: 7, reason: "Concurrent retry test" };
  const retries = await Promise.all(Array.from({ length: 12 }, () => moveInventory(owner.id, itemInput.id, entry, database)));
  assert.ok(retries.every(value => value.id === retries[0]?.id));
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: itemInput.id } })).stock, 7);
  await assert.rejects(moveInventory(owner.id, itemInput.id, { ...entry, quantity: 8 }, database), /KEY_CONFLICT/);
  await assert.rejects(moveInventory(other.id, itemInput.id, entry, database), /NOT_FOUND/);
  await assert.rejects(inventoryHistory(other.id, itemInput.id, 1, database), /NOT_FOUND/); pass(stage);

  stage = "DATABASE_CONSTRAINTS_AND_ATOMIC_ROLLBACK";
  for (const fields of [
    { type: "OUT", quantity: 0, previousStock: 7, resultingStock: 7 },
    { type: "IN", quantity: 1, previousStock: 7, resultingStock: 99 },
    { type: "ADJUSTMENT", quantity: 2, previousStock: 7, resultingStock: 3 },
  ]) await assert.rejects(database.inventoryMovement.create({ data: { ...fields, key: randomUUID(), itemId: itemInput.id, reason: "Invalid test record" } }));
  await assert.rejects(database.inventoryItem.update({ where: { id: itemInput.id }, data: { stock: -1 } }));
  await assert.rejects(database.inventoryItem.create({ data: { userId: randomUUID(), name: "Invalid foreign key", sku: "INVALID" } }));
  await database.$executeRawUnsafe(`CREATE FUNCTION "${schema}".inventory_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'FORCE_ROLLBACK' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER inventory_test_failure BEFORE INSERT ON "${schema}".inventory_movements FOR EACH ROW EXECUTE FUNCTION "${schema}".inventory_test_fail()`);
  await assert.rejects(moveInventory(owner.id, itemInput.id, { key: randomUUID(), type: "IN", quantity: 5, reason: "FORCE_ROLLBACK" }, database));
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: itemInput.id } })).stock, 7);
  await moveInventory(owner.id, itemInput.id, { key: randomUUID(), type: "ADJUSTMENT", quantity: 0, reason: "Counted zero test" }, database);
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: itemInput.id } })).stock, 0); pass(stage);

  stage = "PAGINATION_SEARCH_AND_HISTORY";
  for (let index = 0; index < 26; index++) await createInventory(owner.id, { id: randomUUID(), name: `Page test ${index}`, sku: `PAGE-${index}`, minimumStock: 0 }, database);
  const first = await listInventory(owner.id, 1, "page test", database);
  const second = await listInventory(owner.id, 2, "PAGE-", database);
  assert.equal(first.total, 26); assert.equal(first.items.length, 24); assert.equal(second.items.length, 2);
  assert.ok(!first.items.some(item => second.items.some(otherItem => otherItem.id === item.id)));
  assert.equal((await listInventory(other.id, 1, "PAGE-", database)).total, 0);
  await createInventory(owner.id, { id: randomUUID(), name: "Literal wildcard test", sku: "LITERAL-%_\\", minimumStock: 0 }, database);
  for (const term of ["%", "_", "\\"]) assert.equal((await listInventory(owner.id, 1, term, database)).total, 1);
  for (let index = 0; index < 26; index++) await moveInventory(owner.id, itemInput.id, { key: randomUUID(), type: "IN", quantity: 1, reason: "History page test" }, database);
  const historyFirst = await inventoryHistory(owner.id, itemInput.id, 1, database);
  const historySecond = await inventoryHistory(owner.id, itemInput.id, 2, database);
  assert.equal(historyFirst.movements.length, 24); assert.ok(historySecond.movements.length > 0);
  assert.ok(!historyFirst.movements.some(value => historySecond.movements.some(other => other.id === value.id))); pass(stage);

  stage = "CLOSED_ACCOUNT_STALE_REQUESTS";
  await database.user.update({ where: { id: other.id }, data: { closedAt: new Date(), sessionVersion: { increment: 1 } } });
  await assert.rejects(createInventory(other.id, { id: randomUUID(), name: "Stale request", sku: "CLOSED", minimumStock: 0 }, database), /ACCOUNT_CLOSED/);
  await assert.rejects(moveInventory(other.id, otherItem.id, entry, database), /ACCOUNT_CLOSED/); pass(stage);

  stage = "MIGRATION_LEDGER";
  const ledger = await database.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(ledger.map(value => value.migration_name), names); pass(stage);
  console.log(JSON.stringify({ passed: passed.length, schema, migrations: ledger.length, retainedSyntheticData: true, productionAccess: false }));
}

if (require.main === module) main().catch(error => {
  console.error(`FAIL ${stage}: ${error instanceof Error ? error.name : "ERROR"}`);
  process.exitCode = 1;
}).finally(async () => { await db?.$disconnect(); });
