import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import type { AuthenticatedRequest } from "../types/auth.types";
import { prisma } from "../config/prisma";
import { createCatalog, findPublicCatalog, updateCatalog } from "./catalog.repository";
import type { Prisma } from "@prisma/client";
import { CatalogThemeError } from "../schemas/catalog-theme";

test("theme writes preserve omission, clear with null, and always scope updates to their owner", async () => {
  const calls: unknown[] = [];
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(database);
    if (key === "$queryRaw") return async (sql: TemplateStringsArray) => {
      assert.match(sql.join(""), /"userId" = .*FOR UPDATE/s);
      return [{ template: "FASHION", themePreset: "forest" }];
    };
    if (key === "catalog") return {
      create: async (args: unknown) => { calls.push(args); return { id: "catalog" }; },
      updateMany: async (args: unknown) => { calls.push(args); return { count: 1 }; },
    };
    throw new Error("Unexpected database call");
  } });
  await createCatalog({ userId: "owner", name: "Local", slug: "local", themePreset: "forest" }, database);
  await updateCatalog("catalog", "owner", { name: "Nuevo" }, database);
  await updateCatalog("catalog", "owner", { themePreset: null }, database);
  await updateCatalog("catalog", "other-owner", { themePreset: "night-mint" }, database);
  assert.deepEqual(calls, [
    { data: { userId: "owner", name: "Local", slug: "local", themePreset: "forest" } },
    { where: { id: "catalog", userId: "owner" }, data: { name: "Nuevo" } },
    { where: { id: "catalog", userId: "owner" }, data: { themePreset: null } },
    { where: { id: "catalog", userId: "other-owner" }, data: { themePreset: "night-mint" } },
  ]);
});

function themeDatabase(template = "FASHION", themePreset: string | null = null) {
  const row = { template, themePreset };
  let queue = Promise.resolve();
  let writes = 0;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const run = queue.then(() => work(database));
      queue = run.then(() => undefined, () => undefined);
      return run;
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(sql.join(""), /WHERE id = .*AND "userId" = .*FOR UPDATE/s);
      return values[0] === "catalog" && values[1] === "owner" ? [{ ...row }] : [];
    };
    if (key === "catalog") return {
      create: async () => { writes++; return { id: "catalog" }; },
      updateMany: async (args: { where: { id: string; userId: string }; data: { template?: string; themePreset?: string | null } }) => {
        assert.deepEqual(args.where, { id: "catalog", userId: "owner" });
        if (args.data.template !== undefined) row.template = args.data.template;
        if (args.data.themePreset !== undefined) row.themePreset = args.data.themePreset;
        writes++; return { count: 1 };
      },
    };
    throw new Error("Unexpected database call");
  } });
  return { database, row, get writes() { return writes; } };
}

test("all eight presets save on compatible designs and omission preserves the persisted preset", async () => {
  for (const template of ["FASHION", "EDITORIAL", "BEAUTY", "BOUTIQUE", "GLAMOUR", "TECH", "GRID"]) {
    const f = themeDatabase(template);
    for (const themePreset of ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber"]) {
      if (["TECH", "GRID"].includes(template) && !themePreset.startsWith("night-")) continue;
      await createCatalog({ userId: "owner", name: "Local", slug: "local", template, themePreset }, f.database);
      await updateCatalog("catalog", "owner", { themePreset }, f.database);
      await updateCatalog("catalog", "owner", { template }, f.database);
      assert.equal(f.row.themePreset, themePreset);
    }
    await updateCatalog("catalog", "owner", { themePreset: null }, f.database);
    assert.equal(f.row.themePreset, null);
  }
});

test("server rejects forged full and partial incompatible combinations without changing the row", async () => {
  for (const template of ["TECH", "GRID"]) {
    const f = themeDatabase(template, "night-mint");
    for (const themePreset of ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "unknown", "__proto__"]) {
      await assert.rejects(updateCatalog("catalog", "owner", { themePreset }, f.database), CatalogThemeError);
      await assert.rejects(createCatalog({ userId: "owner", name: "Local", slug: "local", template, themePreset }, f.database), CatalogThemeError);
    }
    assert.equal(f.writes, 0);
    assert.equal(f.row.themePreset, "night-mint");
  }
  const f = themeDatabase("FASHION", "forest");
  await assert.rejects(updateCatalog("catalog", "owner", { template: "TECH" }, f.database), CatalogThemeError);
  await assert.rejects(updateCatalog("catalog", "owner", { template: "GRID", themePreset: "forest" }, f.database), CatalogThemeError);
  assert.deepEqual(f.row, { template: "FASHION", themePreset: "forest" });
  assert.deepEqual(await updateCatalog("catalog", "other-owner", { themePreset: "ocean" }, f.database), { count: 0 });
  assert.equal(f.writes, 0);
});

test("concurrent template and preset writes validate the merged pair while holding the catalog lock", async () => {
  for (const reverse of [false, true]) {
    const f = themeDatabase();
    const patches = reverse ? [{ themePreset: "forest" }, { template: "TECH" }] : [{ template: "TECH" }, { themePreset: "forest" }];
    const results = await Promise.allSettled(patches.map(patch => updateCatalog("catalog", "owner", patch, f.database)));
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
    assert.equal(f.writes, 1);
    assert.ok(f.row.template !== "TECH" || f.row.themePreset === null);
  }
});

test("HTTP controller rejects forged presets and incompatible partial updates with controlled 400 responses", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "local-theme-test-only";
  const { makeUpdateCatalogController, createCatalogController } = await import("../controllers/catalog.controller.js");
  const f = themeDatabase("GRID", "night-mint");
  const updateCatalogController = makeUpdateCatalogController((id, owner, data) => updateCatalog(id, owner, data, f.database));
  const app = express();
  app.use(express.json());
  // Authentication is covered by the existing suite; this fixture supplies an owner.
  app.use((req: AuthenticatedRequest, _res, next) => {
    req.user = { id: req.headers["x-test-other-owner"] ? "other-owner" : "owner", email: "owner@example.invalid", emailVerifiedAt: null, hasLocalPassword: false };
    next();
  });
  app.put("/catalogs/:id", updateCatalogController);
  app.post("/catalogs", createCatalogController);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/catalogs/catalog`;
  const put = (body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    for (const body of [{ themePreset: "forest" }, { template: "TECH", themePreset: "forest" }, { themePreset: "unknown" }]) {
      assert.equal((await put(body)).status, 400);
    }
    assert.equal((await fetch(new URL("/catalogs", url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Local", slug: "local", template: "TECH", themePreset: "forest" }) })).status, 400);
    for (const themePreset of ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber"]) {
      assert.equal((await put({ template: "FASHION", themePreset })).status, 200);
      assert.equal(f.row.themePreset, themePreset);
    }
    assert.equal((await put({ template: "TECH", themePreset: null })).status, 200);
    assert.equal((await put({ themePreset: "night-amber" })).status, 200);
    assert.equal((await put({ template: "TECH" })).status, 200);
    assert.equal(f.row.themePreset, "night-amber");
    assert.equal((await put({ themePreset: null }, { "x-test-other-owner": "yes" })).status, 404);
    assert.equal(f.row.themePreset, "night-amber");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("public catalog explicitly selects its preset and keeps publication filters", async () => {
  const calls: { where: unknown; select: { themePreset?: boolean } }[] = [];
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "catalog") return {
      findFirst: async (args: typeof calls[number]) => { calls.push(args); return null; },
    };
    throw new Error("Unexpected database call");
  } });
  await findPublicCatalog("public-id", database);
  assert.deepEqual(calls[0]?.where, { publicId: "public-id", active: true, archivedAt: null });
  assert.equal(calls[0]?.select.themePreset, true);
});
