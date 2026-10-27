import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";

const requireModule = createRequire(__filename);
const schema = `highlights_verify_${randomUUID().replaceAll("-", "")}`;
const reportPath = process.argv[2] ?? path.join(tmpdir(), "catalog-highlights-postgres-results.json");
const migration = "20261026180000_catalog_featured_banners";
const checks: { check: string; passed: boolean }[] = [];
const observations: Record<string, unknown> = {};
const diagnostics: { operation: string; code: string }[] = [];
let stage = "INPUT_VALIDATION", createdSchema = false, cleanup = false;
let db: PrismaClient | undefined, applicationDb: PrismaClient | undefined, directory: string | undefined;
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
const passed = () => checks.push({ check: stage, passed: true });

async function main() {
  assert.equal(path.basename(reportPath), "catalog-highlights-postgres-results.json");
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
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connect_timeout", "5");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  passed();
  db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const database = db;
  stage = "LOCAL_DATABASE_IDENTITY";
  const [identity] = await database.$queryRaw<{ database: string; address: string }[]>`SELECT current_database() AS database, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.database === "catalogo_test" && loopback(identity.address)); passed();
  stage = "ISOLATED_SCHEMA";
  assert.match(schema, /^highlights_verify_[a-f0-9]{32}$/);
  await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); createdSchema = true; passed();
  const root = path.resolve(__dirname, "../../prisma/migrations");
  const names = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.equal(names.length, 19); assert.equal(names[18], migration);
  directory = await mkdtemp(path.join(tmpdir(), "catalog-highlights-migrations-"));
  await mkdir(path.join(directory, "migrations"));
  await cp(path.resolve(root, "../schema.prisma"), path.join(directory, "schema.prisma"));
  await cp(path.join(root, "migration_lock.toml"), path.join(directory, "migrations/migration_lock.toml"));
  for (const name of names.slice(0, 18)) await cp(path.join(root, name), path.join(directory, "migrations", name), { recursive: true });
  function deploy() {
    const result = spawnSync(process.execPath, [requireModule.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(directory ?? "", "schema.prisma")], {
      cwd: directory, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    if (result.status !== 0) diagnostics.push({ operation: stage, code: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/\bP\d{4}\b/)?.[0] ?? "MIGRATION_DEPLOY_FAILED" });
    assert.equal(result.status, 0);
  }
  stage = "PREVIOUS_18_MIGRATIONS"; deploy();
  const before = await database.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  assert.deepEqual(before.map(row => row.migration_name), names.slice(0, 18)); observations.previousMigrationCount = before.length; passed();
  stage = "PREEXISTING_PRODUCT_FIXTURES";
  const owner = randomUUID(), catalog = randomUUID(), existing = randomUUID();
  await database.$executeRawUnsafe(`INSERT INTO "${schema}".users (id,email,"updatedAt") VALUES ($1,$2,NOW())`, owner, `${owner}@example.invalid`);
  await database.$executeRawUnsafe(`INSERT INTO "${schema}".catalogs (id,"userId",name,slug,"publicId","updatedAt") VALUES ($1,$2,'Ensayo local','ensayo',$3,NOW())`, catalog, owner, randomUUID());
  await database.$executeRawUnsafe(`INSERT INTO "${schema}".products (id,"catalogId",name,slug,price,"updatedAt") VALUES ($1,$2,'Existente','existente',1000,NOW())`, existing, catalog); passed();
  stage = "MIGRATION_APPLIES_OVER_18";
  await cp(path.join(root, migration), path.join(directory, "migrations", migration), { recursive: true }); deploy();
  const ledger = await database.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  assert.deepEqual(ledger.map(row => row.migration_name), names); observations.finalMigrationCount = ledger.length; passed();
  stage = "FEATURED_BOOLEAN_NOT_NULL_DEFAULT_FALSE";
  const [column] = await database.$queryRaw<{ data_type: string; is_nullable: string; column_default: string | null }[]>`SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=${schema} AND table_name='products' AND column_name='featured'`;
  assert.deepEqual(column, { data_type: "boolean", is_nullable: "NO", column_default: "false" }); observations.column = column; passed();
  stage = "BANNER_CONSTRAINTS_AND_INDEX";
  const constraints = await database.$queryRaw<{ conname: string; contype: string; condeferrable: boolean; condeferred: boolean; definition: string }[]>`
    SELECT c.conname,c.contype::text,c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=${schema} AND t.relname='catalog_banners'`;
  for (const name of ["catalog_banners_linkType_check", "catalog_banners_position_check", "catalog_banners_catalogId_fkey", "catalog_banners_pkey"]) assert.ok(constraints.some(row => row.conname === name));
  const linkCheck = constraints.find(row => row.conname === "catalog_banners_linkType_check");
  assert.ok(linkCheck && ["PRODUCT", "CATEGORY", "EXTERNAL"].every(type => linkCheck.definition.includes(type)));
  const positionCheck = constraints.find(row => row.conname === "catalog_banners_position_check");
  assert.ok(positionCheck && /position.*>= 0/.test(positionCheck.definition) && /position.*<= 2/.test(positionCheck.definition));
  const foreignKey = constraints.find(row => row.conname === "catalog_banners_catalogId_fkey");
  assert.ok(foreignKey && foreignKey.contype === "f" && /REFERENCES .*catalogs\(id\).*ON DELETE CASCADE/.test(foreignKey.definition));
  const unique = constraints.find(row => row.conname === "catalog_banners_catalogId_position_key");
  assert.ok(unique?.condeferrable && unique.condeferred && unique.contype === "u");
  assert.match(unique.definition, /UNIQUE \("catalogId", "?position"?\)/);
  const indexes = await database.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=${schema} AND tablename='catalog_banners'`;
  assert.ok(indexes.some(row => row.indexname === "catalog_banners_catalogId_position_idx" && /\("catalogId", "?position"?\)/.test(row.indexdef)));
  const tables = await database.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=${schema} AND table_name='catalog_banners' AND table_type='BASE TABLE'`;
  assert.equal(Number(tables[0]?.n), 1); observations.constraints = constraints; passed();
  stage = "EXISTING_PRODUCTS_FALSE_AND_NO_AUTOMATIC_BANNERS";
  assert.equal((await database.product.findUniqueOrThrow({ where: { id: existing } })).featured, false);
  assert.equal(await database.product.count({ where: { featured: true } }), 0);
  assert.equal(await database.catalogBanner.count(), 0); passed();
  // Application modules are imported only after destination validation and migration.
  const { prisma } = await import("../config/prisma.js"); applicationDb = prisma;
  const { updateProduct } = await import("../repositories/product.repository.js");
  const { saveBanner, reorderBanners } = await import("../repositories/catalog-banner.repository.js");
  const { findPublicCatalog } = await import("../repositories/catalog.repository.js");
  stage = "CONCURRENT_SIXTH_FEATURED";
  const products = await Promise.all(Array.from({ length: 6 }, (_, i) => database.product.create({ data: { catalogId: catalog, name: `Producto ${i}`, slug: `p-${i}`, price: 1000 } })));
  await database.product.updateMany({ where: { id: { in: products.slice(0, 4).map(row => row.id) } }, data: { featured: true } });
  const selections = await Promise.allSettled(products.slice(4).map(product => updateProduct(product.id, owner, { featured: true }, database)));
  assert.equal(selections.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(selections.some(result => result.status === "rejected" && result.reason instanceof Error && result.reason.message === "FEATURED_LIMIT"));
  observations.featuredPersisted = await database.product.count({ where: { catalogId: catalog, featured: true } });
  assert.equal(observations.featuredPersisted, 5); passed();
  const bannerInput = { title: "Banner local", linkType: "EXTERNAL" as const, linkValue: "https://example.invalid" };
  stage = "CONCURRENT_FOURTH_BANNER";
  for (let i = 0; i < 2; i++) await saveBanner(catalog, owner, undefined, bannerInput, `${catalog}/banners/${randomUUID()}.png`, database);
  const inserts = await Promise.allSettled([0, 1].map(() => saveBanner(catalog, owner, undefined, bannerInput, `${catalog}/banners/${randomUUID()}.png`, database)));
  assert.equal(inserts.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(inserts.some(result => result.status === "rejected" && result.reason instanceof Error && result.reason.message === "BANNER_LIMIT"));
  observations.bannersPersisted = await database.catalogBanner.count({ where: { catalogId: catalog } }); assert.equal(observations.bannersPersisted, 3); passed();
  stage = "SWAP_POSITIONS_IN_ONE_TRANSACTION";
  const banners = await database.catalogBanner.findMany({ where: { catalogId: catalog }, orderBy: { position: "asc" } });
  await reorderBanners(catalog, owner, [banners[1].id, banners[0].id, banners[2].id], database);
  assert.equal((await database.catalogBanner.findUniqueOrThrow({ where: { id: banners[1].id } })).position, 0);
  assert.equal((await database.catalogBanner.findUniqueOrThrow({ where: { id: banners[0].id } })).position, 1); passed();
  stage = "BROKEN_DESTINATION_OMITTED_INDEPENDENTLY";
  const doomed = await database.product.create({ data: { catalogId: catalog, name: "Destino", slug: "destino", price: 1000 } });
  await saveBanner(catalog, owner, banners[0].id, { linkType: "PRODUCT", linkValue: doomed.id }, undefined, database);
  await database.product.delete({ where: { id: doomed.id } });
  const publicId = (await database.catalog.findUniqueOrThrow({ where: { id: catalog } })).publicId;
  const visible = await findPublicCatalog(publicId, database); assert.ok(visible);
  assert.equal(visible.banners.length, 2); assert.ok(visible.banners.every(row => row.id !== banners[0].id));
  assert.equal(visible.featuredProducts.length, 5); observations.publicBannersAfterBrokenTarget = visible.banners.length; passed();
}

async function run() {
  let failure: string | null = null;
  try { await main(); }
  catch (error) {
    failure = stage; checks.push({ check: stage, passed: false });
    diagnostics.push({ operation: stage, code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "OPERATION_FAILED" });
  } finally {
    try {
      if (applicationDb) await applicationDb.$disconnect();
      if (createdSchema && db && /^highlights_verify_[a-f0-9]{32}$/.test(schema)) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      if (db) await db.$disconnect();
      if (directory) {
        const resolved = path.resolve(directory);
        assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("catalog-highlights-migrations-"));
        await rm(resolved, { recursive: true, force: true });
      }
      cleanup = true;
    } catch { failure ??= "CLEANUP_FAILED"; }
  }
  const report = { success: failure === null, failedStage: failure, database: "catalogo_test", transport: "loopback", isolatedSchema: createdSchema ? schema : null, cleanup, checks, observations, diagnostics };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = failure ? 1 : 0;
}
void run().catch(() => { process.stdout.write('{"success":false,"failedStage":"REPORT_FAILED"}\n'); process.exitCode = 1; });
