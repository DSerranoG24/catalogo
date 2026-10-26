import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import type { Server } from "node:http";
import { Prisma, PrismaClient } from "@prisma/client";

const requireModule = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `theme_verify_${runId}`;
const reportPath = process.argv[2] ?? path.join(tmpdir(), "catalog-theme-postgres-results.json");
const checks: { check: string; passed: boolean }[] = [];
const diagnostics: { operation: string; code: string }[] = [];
const observations: Record<string, number | string | boolean> = {};
let stage = "INPUT_VALIDATION";
let db: PrismaClient | undefined;
let appDb: PrismaClient | undefined;
let server: Server | undefined;
let temporaryDirectory: string | undefined;
let createdSchema = false;
let cleanup = false;
let visualEvidence: unknown;
const lastMigration = "20261026120000_catalog_theme_preset";
const templates = ["TECH", "FASHION", "BEAUTY", "GLAMOUR", "EDITORIAL", "GRID", "BOUTIQUE"];
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
function passed(check: string) { checks.push({ check, passed: true }); }

async function main() {
  assert.equal(path.basename(reportPath), "catalog-theme-postgres-results.json");
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length <= 8192); }
  const target = new URL(input.trim()); input = "";
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test"); assert.equal(target.hash, "");
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  const addresses = await lookup(host, { all: true });
  assert.ok(addresses.length && addresses.every(address => loopback(address.address)));
  target.search = ""; target.searchParams.set("schema", schema);
  target.searchParams.set("connect_timeout", "5");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = randomBytes(48).toString("hex");
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "local-theme-fixture-only";
  passed(stage);
  db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const database = db;
  stage = "LOCAL_DATABASE_IDENTITY";
  const [identity] = await database.$queryRaw<{ database: string; address: string }[]>`SELECT current_database() AS database, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.database === "catalogo_test" && loopback(identity.address)); passed(stage);
  // Only this generated schema is created, populated, migrated and removed.
  await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); createdSchema = true;
  await database.$disconnect();
  const [namespace] = await database.$queryRaw<{ correct: boolean }[]>`SELECT current_schema() = ${schema} AS correct`;
  assert.equal(namespace?.correct, true);
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "catalog-theme-migrations-"));
  const migrationRoot = path.resolve("prisma/migrations");
  const names = (await readdir(migrationRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(names.length, 18); assert.equal(names[17], lastMigration);
  await writeFile(path.join(temporaryDirectory, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await mkdir(path.join(temporaryDirectory, "migrations"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(temporaryDirectory, "migrations/migration_lock.toml"));
  for (const name of names.slice(0, 17)) await cp(path.join(migrationRoot, name), path.join(temporaryDirectory, "migrations", name), { recursive: true });
  function deploy() {
    const result = spawnSync(process.execPath, [requireModule.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(temporaryDirectory ?? "", "schema.prisma")], {
      cwd: temporaryDirectory, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    // Prisma output can contain connection details; emit only its fixed error code.
    if (result.status !== 0) diagnostics.push({ operation: stage, code: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/\bP\d{4}\b/)?.[0] ?? "MIGRATION_DEPLOY_FAILED" });
    assert.equal(result.status, 0);
  }
  stage = "PREVIOUS_17_MIGRATIONS"; deploy();
  const ledger = await database.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  assert.deepEqual(ledger.map(row => row.migration_name), names.slice(0, 17));
  observations.previousMigrationCount = ledger.length;
  const absent = await database.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'catalogs' AND column_name = 'themePreset'`;
  assert.equal(Number(absent[0]?.n), 0); passed(stage);
  stage = "PREEXISTING_CATALOG_FIXTURES";
  const owner = await database.user.create({ data: { email: `theme_${runId}@example.invalid`, emailVerifiedAt: new Date() }, select: { id: true, email: true } });
  const catalogs = [];
  for (const template of templates) {
    const catalogOwner = await database.user.create({ data: { email: `theme_${runId}_${template}@example.invalid` }, select: { id: true } });
    catalogs.push(await database.catalog.create({ data: {
    userId: catalogOwner.id, name: "Catálogo local", slug: "demo", publicId: template, template,
    description: "Prueba visual local", whatsappPhone: "+573000000000", phone: "+573000000000", businessHours: "Lunes a viernes",
  }, select: { id: true, publicId: true } }));
  }
  passed(stage);
  stage = "MIGRATION_APPLIES_OVER_17";
  await cp(path.join(migrationRoot, lastMigration), path.join(temporaryDirectory, "migrations", lastMigration), { recursive: true }); deploy();
  const after = await database.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  assert.equal(Number(after[0]?.n), 18); observations.finalMigrationCount = 18; passed(stage);
  stage = "COLUMN_TEXT_NULLABLE";
  const [column] = await database.$queryRaw<{ data_type: string; is_nullable: string; column_default: string | null }[]>`SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'catalogs' AND column_name = 'themePreset'`;
  assert.deepEqual(column, { data_type: "text", is_nullable: "YES", column_default: null });
  observations.columnType = column.data_type; observations.columnNullable = column.is_nullable === "YES"; passed(stage);
  stage = "PREEXISTING_CATALOGS_REMAIN_NULL";
  assert.equal(await database.catalog.count({ where: { id: { in: catalogs.map(catalog => catalog.id) }, themePreset: null } }), 7);
  observations.preexistingCatalogs = 7; passed(stage);

  // Import application code only after replacing the environment and validating the DB.
  const express = (await import("express")).default;
  const { prisma } = await import("../config/prisma.js"); appDb = prisma;
  const { authenticate } = await import("../middlewares/auth.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const { updateCatalogController, createCatalogController } = await import("../controllers/catalog.controller.js");
  const { getPublicCatalogController } = await import("../controllers/public-catalog.controller.js");
  const { getPublicProductReviewsController } = await import("../controllers/product-review.controller.js");
  const app = express(); app.use(express.json());
  app.get("/api/public/catalogs/:publicId", getPublicCatalogController);
  app.get("/api/public/catalogs/:publicId/products/:productSlug/reviews", getPublicProductReviewsController);
  app.put("/api/catalogs/:id", authenticate, updateCatalogController);
  app.post("/api/catalogs", authenticate, createCatalogController);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const token = generateToken({ userId: owner.id, email: owner.email });
  const fixture = await database.catalog.create({ data: { userId: owner.id, name: "Write fixture", slug: `write-${runId}`, template: "FASHION" }, select: { id: true } });
  const put = (body: unknown) => fetch(`${base}/catalogs/${fixture.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const current = () => database.catalog.findUniqueOrThrow({ where: { id: fixture.id }, select: { template: true, themePreset: true } });
  stage = "SAVE_VALID_PRESET"; assert.equal((await put({ themePreset: "forest" })).status, 200); assert.equal((await current()).themePreset, "forest"); passed(stage);
  stage = "SAVE_NULL_CLEARS"; assert.equal((await put({ themePreset: null })).status, 200); assert.equal((await current()).themePreset, null); passed(stage);
  stage = "OMISSION_PRESERVES"; assert.equal((await put({ themePreset: "ocean" })).status, 200); assert.equal((await put({ template: "FASHION", name: "Changed fixture" })).status, 200); assert.equal((await current()).themePreset, "ocean"); passed(stage);
  stage = "UNKNOWN_PRESET_REJECTED"; assert.equal((await put({ themePreset: "unknown" })).status, 400); assert.equal((await current()).themePreset, "ocean"); passed(stage);
  stage = "TECH_INCOMPATIBILITY_REJECTED";
  const beforeIncompatible = await current();
  observations.incompatiblePartialStatus = (await put({ template: "TECH" })).status;
  observations.incompatibleFullStatus = (await put({ template: "TECH", themePreset: "forest" })).status;
  observations.incompatibleCreateStatus = (await fetch(`${base}/catalogs`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Rejected fixture", slug: "rejected", template: "TECH", themePreset: "forest" }) })).status;
  assert.equal(observations.incompatiblePartialStatus, 400);
  assert.equal(observations.incompatibleFullStatus, 400);
  assert.equal(observations.incompatibleCreateStatus, 400);
  // The service canonicalizes FASHION to EDITORIAL; rejected writes must preserve it.
  assert.deepEqual(await current(), beforeIncompatible); passed(stage);

  stage = "NULL_CATALOG_REAL_DATABASE_FIXTURES";
  for (const catalog of catalogs) {
    const category = await database.category.create({ data: { catalogId: catalog.id, name: "Selección", slug: "seleccion" }, select: { id: true } });
    for (let index = 0; index < 21; index++) await database.product.create({ data: {
      catalogId: catalog.id, categoryId: category.id, name: `Producto local ${index + 1}`, slug: `producto-${index}`, description: "Prueba local",
      price: index === 1 ? 2000 : 1000, salePrice: index === 1 ? 1000 : null,
      saleStartsAt: index === 1 ? new Date("2000-01-01T00:00:00Z") : null, saleEndsAt: index === 1 ? new Date("2099-01-01T00:00:00Z") : null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 12) - index * 1000),
    }, select: { id: true } });
    const response = await fetch(`${base}/public/catalogs/${catalog.publicId}`);
    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(payload && typeof payload === "object" && "catalog" in payload);
    assert.ok(payload.catalog && typeof payload.catalog === "object" && "themePreset" in payload.catalog && payload.catalog.themePreset === null);
  }
  passed(stage);
  stage = "NULL_VISUAL_HISTORICAL_COMPARISON";
  const frontend = path.resolve("../catalog-generator");
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", CATALOG_THEME_LOCAL_API: base };
  delete childEnv.DATABASE_URL;
  delete childEnv.JWT_SECRET;
  delete childEnv.SUPABASE_SECRET_KEY;
  const child = spawn(process.execPath, ["scripts/verify-ui-pilot.mjs", "--https-api", "--public-themes", "--null-themes-only", "--theme-baseline", path.join(tmpdir(), "catalog-theme-baseline.json")], {
    cwd: frontend, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", chunk => { output += String(chunk); });
  const [exitCode] = await once(child, "exit");
  if (exitCode !== 0) {
    observations.visualExitCode = typeof exitCode === "number" ? exitCode : -1;
    const start = output.indexOf('{"success":false');
    if (start >= 0) {
      try {
        const failure: unknown = JSON.parse(output.slice(start).trim());
        if (failure && typeof failure === "object" && "reason" in failure && typeof failure.reason === "string") {
          observations.visualFailure = failure.reason.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g, "[redacted-url]").slice(0, 400);
        }
      } catch { /* Only structured browser diagnostics are eligible for the report. */ }
    }
  }
  assert.equal(exitCode, 0, "LOCAL_BROWSER_COMPARISON_FAILED");
  const start = output.indexOf('{\n  "success"'); assert.ok(start >= 0);
  const parsed: unknown = JSON.parse(output.slice(start));
  assert.ok(parsed && typeof parsed === "object" && "success" in parsed && parsed.success === true && "publicThemes" in parsed);
  assert.ok(parsed.publicThemes && typeof parsed.publicThemes === "object" && "comparisons" in parsed.publicThemes && parsed.publicThemes.comparisons === 112);
  visualEvidence = {
    realDatabase: true, comparisons: parsed.publicThemes.comparisons,
    reviewStates: "reviewRegressions" in parsed.publicThemes && Array.isArray(parsed.publicThemes.reviewRegressions) ? parsed.publicThemes.reviewRegressions.length : 0,
    artifacts: "artifacts" in parsed.publicThemes && typeof parsed.publicThemes.artifacts === "string" ? parsed.publicThemes.artifacts : null,
  };
  observations.visualComparisons = 112; passed(stage);
}

async function run() {
  let failure: string | null = null;
  const previousError = console.error;
  console.error = () => { diagnostics.push({ operation: stage, code: "APPLICATION_LOG_SUPPRESSED" }); };
  try { await main(); }
  catch (error) {
    failure = stage; checks.push({ check: stage, passed: false });
    diagnostics.push({ operation: stage, code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "OPERATION_FAILED" });
  } finally {
    try {
      if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); }
      if (appDb) await appDb.$disconnect();
      if (createdSchema && db && /^theme_verify_[a-f0-9]{32}$/.test(schema)) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      if (db) await db.$disconnect();
      if (temporaryDirectory) {
        const resolved = path.resolve(temporaryDirectory);
        assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("catalog-theme-migrations-"));
        await rm(resolved, { recursive: true, force: true });
      }
      cleanup = true;
    } catch { failure ??= "CLEANUP_FAILED"; }
    console.error = previousError;
  }
  const report = { success: failure === null, failedStage: failure, database: "catalogo_test", transport: "loopback", isolatedSchema: createdSchema ? schema : null, cleanup, checks, observations, diagnostics, visualEvidence };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = failure ? 1 : 0;
}
void run().catch(() => { process.stdout.write('{"success":false,"failedStage":"REPORT_FAILED"}\n'); process.exitCode = 1; });
