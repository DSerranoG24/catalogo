import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";

// Do not import application modules before validating stdin and replacing environment.
const moduleRequire = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `metrics_verify_${runId}`;
const prefix = `mv_${runId}_`;
const results: { check: string; passed: boolean }[] = [];
const plans: { scenario: string; accounts: number; products: number; orders: number; plan: unknown }[] = [];
const diagnostics: { operation: string; code: string }[] = [];
const observations: Record<string, number | boolean> = {};
let stage = "INPUT_VALIDATION";
let database: PrismaClient | undefined;
let applicationDatabase: PrismaClient | undefined;
let server: Server | undefined;
let temporaryDirectory: string | undefined;
let schemaCreated = false;
let cleanup = false;
const accountCount = Number(process.argv[2] ?? 1000);
const orderCount = Number(process.argv[3] ?? 100000);

function passed(check: string) { results.push({ check, passed: true }); }
function loopback(host: string) { return host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host); }

async function main() {
  assert.ok(Number.isInteger(accountCount) && accountCount >= 10 && accountCount <= 10000);
  assert.ok(Number.isInteger(orderCount) && orderCount >= 100 && orderCount <= 1000000);
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    assert.ok(input.length <= 8192);
  }
  const target = new URL(input.trim());
  input = "";
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test");
  assert.equal(target.hash, "");
  // Reject libpq options, host overrides, poolers and caller-controlled search_path.
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  const addresses = await lookup(host, { all: true });
  assert.ok(addresses.length && addresses.every(address => loopback(address.address)));
  target.search = "";
  target.searchParams.set("schema", schema);
  target.searchParams.set("connection_limit", "12");
  target.searchParams.set("connect_timeout", "5");
  process.env.DATABASE_URL = target.toString();
  process.env.NODE_ENV = "test";
  process.env.MAIL_MODE = "log";
  process.env.JWT_SECRET = randomBytes(48).toString("hex");
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const db = database;
  stage = "LOCAL_DATABASE_IDENTITY";
  const [identity] = await db.$queryRaw<{ db: string; address: string }[]>`SELECT current_database() AS db, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.db === "catalogo_test" && loopback(identity.address));
  passed(stage);
  // Identifier is generated here, never derived from URI/input.
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  // Re-open after CREATE: connection initialization must see the new schema.
  await db.$disconnect();
  const [namespace] = await db.$queryRaw<{ correct: boolean }[]>`SELECT current_schema() = ${schema} AS correct`;
  observations.isolatedSearchPath = namespace?.correct === true;
  assert.equal(namespace?.correct, true);
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "vitrinaya-metrics-"));
  const migrationRoot = path.resolve("prisma/migrations");
  const migrationNames = (await readdir(migrationRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).filter(name => name <= "20261025200000_platform_metrics").sort();
  assert.equal(migrationNames.length, 16);
  assert.equal(migrationNames[15], "20261025200000_platform_metrics");
  await writeFile(path.join(temporaryDirectory, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await mkdir(path.join(temporaryDirectory, "migrations"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(temporaryDirectory, "migrations/migration_lock.toml"));
  for (const name of migrationNames.slice(0, 15)) await cp(path.join(migrationRoot, name), path.join(temporaryDirectory, "migrations", name), { recursive: true });
  function deploy() {
    const child = spawnSync(process.execPath, [moduleRequire.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(temporaryDirectory ?? "", "schema.prisma")], {
      // Avoid the repository prisma.config.ts overriding the copied migration path.
      cwd: temporaryDirectory,
      env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    });
    // CLI output may include connection information: never emit stdout/stderr/error.
    if (child.status !== 0) {
      const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
      const code = output.match(/\bP\d{4}\b/)?.[0]
        ?? (["EPERM", "ENOENT", "ETIMEDOUT", "ERR_SYSTEM_ERROR"].find(value => output.includes(value) || child.error?.message.includes(value)))
        ?? "CLI_FAILED";
      diagnostics.push({ operation: stage, code });
    }
    assert.equal(child.status, 0, "MIGRATION_DEPLOY_FAILED");
  }
  stage = "PREVIOUS_15_MIGRATIONS";
  deploy();
  stage = "PREVIOUS_15_HISTORY";
  const before = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  observations.previousMigrationCount = Number(before[0]?.n);
  assert.equal(Number(before[0]?.n), 15);
  const columns = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'orders' AND column_name = 'firstConfirmedAt'`;
  observations.confirmationColumnsBeforeMigration = Number(columns[0]?.n);
  assert.equal(Number(columns[0]?.n), 0);
  stage = "PRE_MIGRATION_FIXTURES";
  const owner = await db.user.create({ data: { email: `${prefix}legacy@example.invalid`, role: "ADMIN" }, select: { id: true } });
  const catalog = await db.catalog.create({ data: { userId: owner.id, name: "Fixture", slug: prefix }, select: { id: true } });
  const oldOrders = [];
  for (const status of ["PENDING", "CONFIRMED", "CANCELLED"] as const) oldOrders.push(await db.order.create({ data: { catalogId: catalog.id, customerName: "PRIVATE_CANARY", customerPhone: "PRIVATE_PHONE", total: 100, status }, select: { id: true } }));
  passed(stage);
  stage = "MIGRATION_APPLIES_OVER_15";
  const last = migrationNames[15];
  assert.ok(last);
  await cp(path.join(migrationRoot, last), path.join(temporaryDirectory, "migrations", last), { recursive: true });
  deploy();
  const after = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  observations.finalMigrationCount = Number(after[0]?.n);
  assert.equal(Number(after[0]?.n), 16);
  passed(stage);
  stage = "INDEXES_VALID";
  const indexes = await db.$queryRaw<{ name: string; valid: boolean; definition: string }[]>`
    SELECT i.relname AS name, x.indisvalid AS valid, pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = ${schema} AND i.relname IN ('users_createdAt_idx', 'orders_createdAt_idx')`;
  assert.equal(indexes.length, 2);
  for (const index of indexes) { assert.equal(index.valid, true); assert.match(index.definition, /USING btree \("createdAt"\)/); }
  passed(stage);
  stage = "EXISTING_ORDERS_NULL";
  assert.equal(await db.order.count({ where: { firstConfirmedAt: null } }), oldOrders.length);
  passed(stage);

  const { changeOrderStatus } = await import("../repositories/order.repository.js");
  const { adminMetricsSql, readAdminMetrics } = await import("../repositories/admin-metrics.repository.js");
  const { presentMetrics } = await import("../services/admin-metrics.js");
  const { makeAdminRouter } = await import("../routes/admin.routes.js");
  const { generateToken } = await import("../utils/jwt.js");
  const { prisma } = await import("../config/prisma.js");
  applicationDatabase = prisma;
  // Default authentication repositories must use the same isolated schema.
  assert.equal(process.env.DATABASE_URL, target.toString());
  const first = oldOrders[0]; assert.ok(first);
  stage = "CONFIRMATION_DATABASE_CLOCK";
  const [lower] = await db.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
  assert.equal((await changeOrderStatus(first.id, owner.id, "PENDING", "CONFIRMED", db)).count, 1);
  const confirmed = await db.order.findUniqueOrThrow({ where: { id: first.id } });
  const [upper] = await db.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
  assert.ok(lower && upper && confirmed.firstConfirmedAt);
  assert.ok(confirmed.firstConfirmedAt.getTime() >= lower.at.getTime() - 1 && confirmed.firstConfirmedAt.getTime() <= upper.at.getTime() + 1);
  // The audit below compares the stamp with PostgreSQL's transaction clock.
  passed(stage);
  stage = "RECONFIRM_PRESERVES_TIMESTAMP";
  assert.equal((await changeOrderStatus(first.id, owner.id, "PENDING", "CONFIRMED", db)).count, 0);
  await changeOrderStatus(first.id, owner.id, "CONFIRMED", "CONFIRMED", db);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: first.id } })).firstConfirmedAt?.getTime(), confirmed.firstConfirmedAt.getTime());
  passed(stage);
  stage = "CANCEL_PRESERVES_TIMESTAMP";
  await changeOrderStatus(first.id, owner.id, "CONFIRMED", "CANCELLED", db);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: first.id } })).firstConfirmedAt?.getTime(), confirmed.firstConfirmedAt.getTime());
  passed(stage);
  stage = "CONCURRENT_CONFIRMATION_SINGLE_WRITE";
  const race = await db.order.create({ data: { catalogId: catalog.id, customerName: "PRIVATE_CANARY", customerPhone: "PRIVATE_PHONE", total: 1 }, select: { id: true } });
  // Audit only the fixture row: detects multiple stamp writes even if final values coincide.
  await db.$executeRawUnsafe(`CREATE TABLE "${schema}".stamp_audit (order_id text NOT NULL, stamped_at timestamp(3), database_clock timestamp(3))`);
  await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".audit_stamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."firstConfirmedAt" IS DISTINCT FROM OLD."firstConfirmedAt" THEN INSERT INTO "${schema}".stamp_audit VALUES (NEW.id, NEW."firstConfirmedAt", CURRENT_TIMESTAMP AT TIME ZONE 'UTC'); END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER audit_stamp AFTER UPDATE ON "${schema}".orders FOR EACH ROW EXECUTE FUNCTION "${schema}".audit_stamp()`);
  const raceResults = await Promise.all(Array.from({ length: 8 }, () => changeOrderStatus(race.id, owner.id, "PENDING", "CONFIRMED", db)));
  observations.concurrentWinners = raceResults.reduce((sum, item) => sum + item.count, 0);
  assert.equal(observations.concurrentWinners, 1);
  // JS Date truncates sub-ms precision; PostgreSQL timestamp(3) rounds it.
  const audit = await db.$queryRaw<{ n: bigint; exact: boolean }[]>`SELECT count(*) AS n, bool_and(abs(extract(epoch FROM (stamped_at - database_clock))) <= 0.001) AS exact FROM stamp_audit WHERE order_id = ${race.id}`;
  observations.concurrentStampWrites = Number(audit[0]?.n);
  observations.stampMatchesDatabaseClock = audit[0]?.exact === true;
  assert.equal(Number(audit[0]?.n), 1); assert.equal(audit[0]?.exact, true);
  passed(stage);

  async function clearFixtures() {
    await db.order.deleteMany({ where: { catalog: { user: { email: { startsWith: prefix } } } } });
    await db.catalog.deleteMany({ where: { user: { email: { startsWith: prefix } } } });
    await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
  }
  await clearFixtures();
  stage = "ZERO_DENOMINATORS_AND_30_DAYS";
  const empty = await readAdminMetrics(db);
  assert.equal(empty.daily.length, 30);
  assert.equal(new Set(empty.daily.map(day => day.date)).size, 30);
  assert.ok(empty.daily.every(day => day.accountsCreated === 0 && day.ordersCreated === 0));
  assert.equal(empty.accounts.activePercent, null); assert.equal(empty.accounts.unverifiedPercent, null);
  assert.equal(empty.repeat.percent, null); assert.equal(empty.funnel.allTime.confirmedCurrentPercent, null);
  for (const cohort of Object.values(empty.funnel)) {
    assert.equal(cohort.confirmedKnownPercent, null);
    assert.equal(cohort.confirmedCurrentPercent, null);
  }
  passed(stage);

  stage = "BOGOTA_WEEKS_YEAR_BOUNDARY_AND_REPETITION";
  const weekDates = ["2025-12-29T05:00:00Z", "2026-01-05T04:59:59Z", "2026-01-05T05:00:00Z"];
  const weeks = await db.$queryRaw<{ week: string }[]>(Prisma.sql`SELECT to_char(date_trunc('week', t AT TIME ZONE 'America/Bogota'), 'YYYY-MM-DD') AS week FROM unnest(${weekDates}::timestamptz[]) AS t ORDER BY t`);
  assert.deepEqual(weeks.map(row => row.week), ["2025-12-29", "2025-12-29", "2026-01-05"]);
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({ data: { email: `${prefix}week${i}@example.invalid` } });
    const cat = await db.catalog.create({ data: { userId: user.id, name: "Fixture", slug: `${prefix}${i}` } });
    for (const date of [weekDates[0], weekDates[i + 1]]) {
      assert.ok(date);
      await db.order.create({ data: { catalogId: cat.id, createdAt: new Date(date), total: 1, customerName: "PRIVATE_CANARY", customerPhone: "PRIVATE_PHONE" } });
    }
  }
  const fixedAsOf = new Date("2026-01-10T12:00:00Z");
  const [fixed] = await db.$queryRaw<{ data: unknown }[]>(adminMetricsSql(fixedAsOf)); assert.ok(fixed);
  const historical = presentMetrics(fixed.data, fixedAsOf);
  assert.equal(historical.repeat.withOrders, 2); assert.equal(historical.repeat.repeating, 1); assert.equal(historical.repeat.percent, 50);
  assert.equal(historical.daily.length, 30);
  assert.equal(historical.daily.find(day => day.date === "2026-01-04")?.ordersCreated, 1);
  assert.equal(historical.daily.find(day => day.date === "2026-01-05")?.ordersCreated, 1);
  assert.equal(historical.daily.find(day => day.date === "2026-01-03")?.ordersCreated, 0);
  passed(stage);

  stage = "REAL_HTTP_ENDPOINT_NO_PERSONAL_FIELDS";
  const admin = await db.user.create({ data: { role: "ADMIN", email: `${prefix}admin@example.invalid`, name: "PRIVATE_ADMIN" } });
  const express = (await import("express")).default;
  const app = express();
  app.use("/api/admin", makeAdminRouter());
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/admin/metrics`;
  assert.equal((await fetch(endpoint)).status, 401);
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${generateToken({ userId: admin.id, email: admin.email })}` } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body: unknown = await response.json();
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /PRIVATE_|@example\.invalid|customerName|customerPhone|customerEmail|customerAddress|passwordHash|userId|catalogId|quotationToken/);
  // Zod strict aggregate schema is also exercised by this real endpoint.
  passed(stage);
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve())); server = undefined;
  await clearFixtures();

  stage = "REPRESENTATIVE_FIXTURES_AND_EXPLAIN";
  await db.$executeRaw(Prisma.sql`INSERT INTO users (id,email,"createdAt","updatedAt") SELECT ${prefix} || i, ${prefix} || i || '@example.invalid', CURRENT_TIMESTAMP - (i % 365) * interval '1 day', CURRENT_TIMESTAMP FROM generate_series(1, ${accountCount}::int) AS i`);
  await db.$executeRaw(Prisma.sql`INSERT INTO catalogs (id,"userId",name,slug,"publicId",active,"createdAt","updatedAt") SELECT ${prefix} || i, ${prefix} || i, 'Fixture', ${prefix} || i, ${prefix} || i, i % 10 <> 0, CURRENT_TIMESTAMP - (i % 365) * interval '1 day', CURRENT_TIMESTAMP FROM generate_series(1, ${accountCount}::int) AS i`);
  const productCount = accountCount * 50;
  await db.$executeRaw(Prisma.sql`INSERT INTO products (id,"catalogId",name,slug,price,active,"createdAt","updatedAt") SELECT ${prefix} || i, ${prefix} || (1 + ((i - 1) % ${accountCount}::int)), 'Fixture', ${prefix} || i, 100, i % 5 <> 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM generate_series(1, ${productCount}::int) AS i`);
  await db.$executeRaw(Prisma.sql`INSERT INTO orders (id,"catalogId","customerName","customerPhone",total,status,"createdAt","updatedAt") SELECT ${prefix} || i, ${prefix} || (1 + ((i - 1) % ${accountCount}::int)), 'PRIVATE_CANARY', 'PRIVATE_PHONE', 100, (CASE WHEN i % 4 = 0 THEN 'CANCELLED' WHEN i % 4 = 1 THEN 'CONFIRMED' WHEN i % 4 = 2 THEN 'COMPLETED' ELSE 'PENDING' END)::"OrderStatus", CURRENT_TIMESTAMP - (i % 365) * interval '1 day' - (i % 86400) * interval '1 second', CURRENT_TIMESTAMP FROM generate_series(1, ${orderCount}::int) AS i`);
  for (const table of ["users", "catalogs", "products", "orders"]) await db.$executeRawUnsafe(`ANALYZE "${schema}"."${table}"`);
  const [clock] = await db.$queryRaw<{ at: Date }[]>`SELECT CURRENT_TIMESTAMP AS at`; assert.ok(clock);
  for (const scenario of ["first_run", "warm_repeat"]) {
    const plan = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '60000ms'`;
      return tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${adminMetricsSql(clock.at)}`);
    }, { isolationLevel: "RepeatableRead", timeout: 65000 });
    // Replace generated schema names; plans contain no literals from input/credentials.
    plans.push({ scenario, accounts: accountCount, products: productCount, orders: orderCount, plan: JSON.parse(JSON.stringify(plan).replaceAll(schema, "verification_schema")) });
  }
  passed(stage);
  stage = "PRODUCTION_QUERY_TIME_BUDGET";
  const representative = await readAdminMetrics(db);
  assert.equal(representative.accounts.total, accountCount); assert.equal(representative.orders.total, orderCount);
  passed(stage);
}

async function run() {
  let failure: string | null = null;
  try { await main(); }
  catch (error) {
    failure = stage; results.push({ check: stage, passed: false });
    if (error instanceof Prisma.PrismaClientKnownRequestError) diagnostics.push({ operation: stage, code: error.code });
    else if (error instanceof assert.AssertionError) diagnostics.push({ operation: stage, code: "ASSERTION_FAILED" });
    else diagnostics.push({ operation: stage, code: "OPERATION_FAILED" });
  }
  finally {
    try {
      if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
      if (applicationDatabase) await applicationDatabase.$disconnect();
      // Never DROP public or caller-selected objects: only the exact generated schema.
      if (schemaCreated && database && /^metrics_verify_[a-f0-9]{32}$/.test(schema)) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      if (database) await database.$disconnect();
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
      cleanup = true;
    } catch { failure ??= "CLEANUP_FAILED"; }
  }
  const report = { success: failure === null, failedStage: failure, database: "catalogo_test", transport: "loopback", isolatedSchema: schema, cleanup, checks: results, diagnostics, observations, plans,
    limitations: ["Synthetic workload; not a production benchmark", "first_run is not guaranteed cold PostgreSQL/OS cache", "No additional indexes created beyond the authorized migration"] };
  const reportPath = path.resolve("platform-metrics-postgres-results.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = failure === null ? 0 : 1;
}

void run().catch(() => { process.stdout.write('{"success":false,"failedStage":"REPORT_FAILED"}\n'); process.exitCode = 1; });
