import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import type { Prisma, User } from "@prisma/client";
import { makeCompatibilityRepository } from "./compatibility.repository";
import { makeCompatibilityService } from "../services/compatibility.service";
import { makeCompatibilityController } from "../controllers/compatibility.controller";
import { createDeviceBrandSchema, createDeviceModelSchema, deviceNameKey, addCompatibilitySchema, updateCompatibilitySchema } from "../schemas/compatibility.schema";

const owner = randomUUID(), other = randomUUID(), itemId = randomUUID(), foreignItem = randomUUID();
const object = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
type Row = Record<string, unknown>;
function fixture() {
  let tables: Record<string, Row[]> = {
    inventoryItem: [{ id: itemId, userId: owner, name: "Accessory", sku: "SKU", stock: 8 }, { id: foreignItem, userId: other, name: "Other" }],
    deviceBrand: [], deviceModel: [], deviceBrandName: [], deviceModelName: [], compatibilitySet: [], itemCompatibility: [], compatibilityOperation: [], compatibilityEvent: [],
  };
  let failure = "", closed = false, tail = Promise.resolve();
  const reads: string[] = [];
  function decorate(table: string, row: Row): Row {
    if (table === "deviceBrand") return { ...row, names: tables.deviceBrandName.filter(n => n.brandId === row.id && n.ownerId === row.ownerId && n.isCanonical && !n.retiredAt) };
    if (table === "deviceModel") {
      const b = tables.deviceBrand.find(b => b.id === row.brandId && b.ownerId === row.ownerId); assert.ok(b);
      return { ...row, names: tables.deviceModelName.filter(n => n.modelId === row.id && n.ownerId === row.ownerId && n.isCanonical && !n.retiredAt), brand: decorate("deviceBrand", b) };
    }
    if (table === "itemCompatibility") {
      const m = tables.deviceModel.find(m => m.id === row.modelId && m.ownerId === row.ownerId); assert.ok(m);
      return { ...row, model: decorate("deviceModel", m) };
    }
    return { ...row };
  }
  function matches(table: string, row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (key === "id_ownerId" || key === "ownerId_operationId") return matches(table, row, object(expected));
      if (key === "AND" || key === "OR") { assert.ok(Array.isArray(expected)); return key === "AND" ? expected.every(w => matches(table,row,object(w))) : expected.some(w => matches(table,row,object(w))); }
      if (key === "set") { const set = tables.compatibilitySet.find(s => s.id === row.setId); return Boolean(set && matches("compatibilitySet",set,object(expected))); }
      if (key === "names") {
        const list = table === "deviceBrand" ? tables.deviceBrandName.filter(n => n.brandId === row.id) : tables.deviceModelName.filter(n => n.modelId === row.id);
        return list.some(n => matches(table === "deviceBrand" ? "deviceBrandName" : "deviceModelName", n, object(object(expected).some)));
      }
      if (key === "brand") { const b = tables.deviceBrand.find(b => b.id === row.brandId); return Boolean(b && matches("deviceBrand",b,object(expected))); }
      if (expected !== null && typeof expected === "object") {
        const filter = object(expected);
        if ("contains" in filter) return typeof row[key] === "string" && String(row[key]).includes(String(filter.contains).replace(/\\([%_\\])/g,"$1"));
        if ("not" in filter) return row[key] !== filter.not;
      }
      return row[key] === expected;
    });
  }
  function scope(table: string, args: Row) {
    const where = object(args.where); const compound = where.id_ownerId ?? where.ownerId_operationId;
    const scoped = compound ? object(compound) : where;
    assert.equal(typeof scoped[table === "inventoryItem" ? "userId" : "ownerId"], "string", "Every resource query must be scoped to its authenticated owner");
    return where;
  }
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const previous = tail; let release = () => {}; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const before = structuredClone(tables);
      try { return await work(db); } catch (e) { tables = before; throw e; } finally { release(); }
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => { assert.match(sql.join("?"), /FROM users.*FOR SHARE/); return closed ? [] : [{ id: values[0] }]; };
    if (key === "$executeRaw") return async (sql: TemplateStringsArray) => { assert.match(sql.join("?"), /pg_advisory_xact_lock.*compatibility-v1/); return 1; };
    if (typeof key === "string" && Object.hasOwn(tables, key)) return {
      findFirst: async (input: unknown) => { const args = object(input), where = scope(key,args); reads.push(key); const row = tables[key].find(r => matches(key,r,where)); return row ? structuredClone(decorate(key,row)) : null; },
      findUnique: async (input: unknown) => { const args = object(input), where = scope(key,args); reads.push(key); const row = tables[key].find(r => matches(key,r,where)); return row ? structuredClone(decorate(key,row)) : null; },
      findMany: async (input: unknown) => {
        const args = object(input), where = scope(key,args); reads.push(key); assert.ok(Number(args.take) <= 26);
        const order = args.orderBy;
        const entries = Array.isArray(order) ? order.map(object) : [object(order)];
        return structuredClone(tables[key].filter(r => matches(key,r,where)).sort((a,b) => {
          for (const entry of entries) for (const [field, dir] of Object.entries(entry)) { const aVal = a[field], bVal = b[field]; const cmp = aVal instanceof Date && bVal instanceof Date ? aVal.getTime() - bVal.getTime() : String(aVal).localeCompare(String(bVal)); if(cmp) return dir === "desc" ? -cmp : cmp; } return 0;
        }).slice(Number(args.skip ?? 0),Number(args.skip ?? 0)+Number(args.take)).map(r => decorate(key,r)));
      },
      create: async (input: unknown) => {
        if (failure === key) throw new Error("fixture-write-failure");
        const data = object(object(input).data); assert.equal(typeof data.ownerId,"string");
        const row: Row = { id: randomUUID(), version: 1, retiredAt: null, createdAt: new Date(), updatedAt: new Date(), occurredAt: new Date(), kind: "INVENTORY_ITEM", status: "PENDING", evidenceType: null, evidenceReference: null, note: null, reviewReason: null, verifiedAt: null, verifiedById: null, isCanonical: false, normalizationVersion: 1, manufacturerCode: null, ...data };
        tables[key].push(row); return structuredClone(decorate(key,row));
      },
      update: async (input: unknown) => {
        const args = object(input), where = scope(key,args), row = tables[key].find(r => matches(key,r,where)); assert.ok(row);
        for (const [field,value] of Object.entries(object(args.data))) row[field] = value !== null && typeof value === "object" && "increment" in value ? Number(row[field]) + Number(object(value).increment) : value;
        row.updatedAt = new Date(); return structuredClone(decorate(key,row));
      },
    };
    throw new Error(`Unexpected database operation (including physical deletes): ${String(key)}`);
  } });
  return { service: makeCompatibilityService(makeCompatibilityRepository(db)), rows: (name: string) => tables[name], fail: (name: string) => { failure = name; }, close: () => { closed = true; }, reads };
}
async function seed(f = fixture(), who = owner) {
  const b = await f.service.createBrand(who, { operationId: randomUUID(), name: "  Oppo  " });
  const m = await f.service.createModel(who, { operationId: randomUUID(), brandId: b.entity.id, name: "A58  4G", manufacturerCode: "CPH-example" });
  return { f, b: b.entity, m: m.entity };
}

test("normalization preserves identity distinctions and rejects spoofed/unknown fields", () => {
  assert.equal(deviceNameKey("  OPPO   A58  "), "oppo a58"); assert.notEqual(deviceNameKey("A58 5G"),deviceNameKey("A58"));
  assert.notEqual(deviceNameKey("A+"),deviceNameKey("A")); assert.notEqual(deviceNameKey("é"),deviceNameKey("e"));
  for (const name of ["", " ", "Op\u200bpo", "Op\npo", "x".repeat(101)]) assert.equal(createDeviceBrandSchema.safeParse({ operationId: randomUUID(), name }).success,false);
  assert.equal(createDeviceBrandSchema.safeParse({ operationId: randomUUID(), name:"Oppo", ownerId:other }).success,false);
  assert.equal(createDeviceModelSchema.safeParse({ operationId: randomUUID(), brandId:other, name:"A58", verifiedAt:new Date() }).success,false);
  assert.equal(addCompatibilitySchema.safeParse({ operationId:randomUUID(),expectedSetVersion:0,modelId:other,status:"VERIFIED" }).success,false);
  assert.equal(updateCompatibilitySchema.safeParse({ operationId:randomUUID(),expectedSetVersion:1,expectedVersion:1,status:"PAID" }).success,false);
});

test("dictionary: canonical/alias namespace, duplicates, code collisions and owner isolation", async () => {
  const {f,b,m} = await seed();
  await assert.rejects(f.service.createBrand(owner,{ operationId:randomUUID(),name:"oPpO" }), /NAME_CONFLICT/);
  await f.service.createBrand(other,{ operationId:randomUUID(),name:"Oppo" });
  await f.service.addAlias(owner,b.id,"brand",{operationId:randomUUID(),expectedVersion:1,label:"OPPO Phones"});
  await assert.rejects(f.service.createBrand(owner,{operationId:randomUUID(),name:"oppo phones"}),/NAME_CONFLICT/);
  await assert.rejects(f.service.addAlias(owner,b.id,"brand",{operationId:randomUUID(),expectedVersion:1,label:"New"}),/VERSION_CONFLICT/);
  const otherBrand = await f.service.createBrand(owner,{operationId:randomUUID(),name:"Realme"});
  await assert.rejects(f.service.addAlias(owner,otherBrand.entity.id,"brand",{operationId:randomUUID(),expectedVersion:1,label:"Oppo"}),/NAME_CONFLICT/);
  await f.service.addAlias(owner,m.id,"model",{operationId:randomUUID(),expectedVersion:1,label:"A58 LTE"});
  await assert.rejects(f.service.createModel(owner,{operationId:randomUUID(),brandId:b.id,name:"A58 LTE"}),/NAME_CONFLICT/);
  await assert.rejects(f.service.createModel(owner,{operationId:randomUUID(),brandId:b.id,name:"Other",manufacturerCode:"cph-example"}),/MODEL_CODE_CONFLICT/);
  await f.service.createModel(owner,{operationId:randomUUID(),brandId:otherBrand.entity.id,name:"A58 4G",manufacturerCode:"CPH-example"});
  assert.equal((await f.service.brands(owner,{q:"phones"})).items[0].id,b.id);
  assert.equal((await f.service.models(owner,{brandId:b.id,q:"LTE"})).items[0].id,m.id);
  await assert.rejects(f.service.detail(other,m.id,"model"),/COMPATIBILITY_RESOURCE_NOT_FOUND/);
  await assert.rejects(f.service.addAlias(other,m.id,"model",{operationId:randomUUID(),expectedVersion:2,label:"X"}),/COMPATIBILITY_RESOURCE_NOT_FOUND/);
  assert.ok(f.rows("compatibilityEvent").every(e => typeof e.actorId === "string" && e.actorId === e.ownerId));
});

test("reads are empty without writes; unknown/foreign item/model rejected atomically", async () => {
  const {f,m} = await seed(); const before = structuredClone(f.rows("inventoryItem"));
  const counts = [f.rows("compatibilityOperation").length,f.rows("compatibilityEvent").length];
  const page = await f.service.list(owner,itemId,{}); assert.equal(page.set,null); assert.deepEqual(page.compatibilities,[]);
  assert.deepEqual([f.rows("compatibilityOperation").length,f.rows("compatibilityEvent").length],counts);
  for(const id of [foreignItem,randomUUID()]) await assert.rejects(f.service.add(owner,id,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id}),/COMPATIBILITY_RESOURCE_NOT_FOUND/);
  for(const id of [m.id,randomUUID()]) await assert.rejects(f.service.add(other,foreignItem,{operationId:randomUUID(),expectedSetVersion:0,modelId:id}),/COMPATIBILITY_RESOURCE_NOT_FOUND/);
  assert.equal(f.rows("compatibilitySet").length,0); assert.deepEqual(f.rows("inventoryItem"),before);
});

test("explicit states, evidence, reasons, reopening, edits and immutable audit snapshots", async () => {
  const {f,m} = await seed();
  let r = await f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id});
  const id = r.compatibility.id; assert.equal(r.compatibility.status,"PENDING");
  const update = (body: Row) => f.service.update(owner,itemId,id,{operationId:randomUUID(),expectedVersion:r.compatibility.version,expectedSetVersion:r.setVersion,...body});
  await assert.rejects(update({status:"VERIFIED"}),/COMPATIBILITY_EVIDENCE_REQUIRED/);
  r = await update({status:"VERIFIED",evidenceType:"SELLER_TEST",evidenceReference:"Synthetic test reference"});
  assert.ok(r.compatibility.verifiedAt); assert.equal(f.rows("itemCompatibility")[0].verifiedById,owner);
  const verifiedEvents = structuredClone(f.rows("compatibilityEvent"));
  await assert.rejects(update({status:"VERIFIED",evidenceReference:"Changed"}),/INVALID_COMPATIBILITY_TRANSITION/);
  r = await update({evidenceReference:"Changed"}); assert.equal(r.compatibility.status,"PENDING"); assert.equal(r.compatibility.verifiedAt,null);
  await assert.rejects(update({status:"REJECTED"}),/COMPATIBILITY_REASON_REQUIRED/);
  r = await update({status:"REJECTED",reviewReason:"Does not fit"});
  await assert.rejects(update({status:"VERIFIED",evidenceType:"SELLER_TEST",note:"Review"}),/INVALID_COMPATIBILITY_TRANSITION/);
  r = await update({status:"PENDING",reviewReason:"Review again"});
  r = await update({status:"WITHDRAWN",reviewReason:"Wrong target selected"});
  assert.equal(r.compatibility.status,"WITHDRAWN");
  await assert.rejects(f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:r.setVersion,modelId:m.id}),/COMPATIBILITY_ALREADY_EXISTS/);
  const events = await f.service.events(owner,itemId,{});
  assert.ok(events.items.some(e => e.eventType === "STATUS_CHANGED"));
  for(const old of verifiedEvents) assert.deepEqual(f.rows("compatibilityEvent").find(e => e.id === old.id),old);
  assert.equal((await f.service.list(owner,itemId,{status:"VERIFIED"})).compatibilities.length,0);
  await assert.rejects(f.service.events(other,itemId,{}),/COMPATIBILITY_RESOURCE_NOT_FOUND/);
});

test("retries, command conflicts, concurrent duplicate creation and no-op do not duplicate history", async () => {
  const {f,m} = await seed(); const command = {operationId:randomUUID(),expectedSetVersion:0,modelId:m.id};
  const [one,two] = await Promise.all([f.service.add(owner,itemId,command),f.service.add(owner,itemId,command)]);
  assert.equal(one.compatibility.id,two.compatibility.id); assert.equal(two.idempotent,true);
  assert.equal(f.rows("itemCompatibility").length,1);
  const beforeEvents = f.rows("compatibilityEvent").length;
  await assert.rejects(f.service.add(owner,itemId,{...command,modelId:randomUUID()}),/IDEMPOTENCY_CONFLICT/);
  const noOp = await f.service.update(owner,itemId,one.compatibility.id,{operationId:randomUUID(),expectedSetVersion:1,expectedVersion:1,note:null});
  assert.equal(noOp.setVersion,1); assert.equal(f.rows("compatibilityEvent").length,beforeEvents);
  const id = randomUUID();
  const create = {operationId:id,name:"Another brand"};
  const [a,b] = await Promise.all([f.service.createBrand(owner,create),f.service.createBrand(owner,create)]);
  assert.equal(a.entity.id,b.entity.id); assert.equal(b.idempotent,true);
});

test("audit write failure rolls back set, relation, receipt and versions; exact retry succeeds", async () => {
  const {f,m} = await seed(); const before = structuredClone(f.rows("inventoryItem"));
  const count = f.rows("compatibilityOperation").length;
  const command = {operationId:randomUUID(),expectedSetVersion:0,modelId:m.id};
  f.fail("compatibilityEvent"); await assert.rejects(f.service.add(owner,itemId,command),/fixture-write-failure/);
  assert.equal(f.rows("compatibilitySet").length,0); assert.equal(f.rows("itemCompatibility").length,0); assert.equal(f.rows("compatibilityOperation").length,count);
  f.fail(""); await f.service.add(owner,itemId,command); assert.equal(f.rows("itemCompatibility").length,1);
  assert.deepEqual(f.rows("inventoryItem"),before);
  f.close(); await assert.rejects(f.service.add(owner,itemId,command),/ACCOUNT_CLOSED/);
});

test("full lifecycle never touches sales, orders, products or stock; items without brand/model keep working", async () => {
  const {f,m} = await seed(); const item = structuredClone(f.rows("inventoryItem"));
  assert.equal("brand" in item[0] || "model" in item[0], false);
  let r = await f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id});
  const step = (body: Row) => f.service.update(owner,itemId,r.compatibility.id,{operationId:randomUUID(),expectedVersion:r.compatibility.version,expectedSetVersion:r.setVersion,...body});
  r = await step({status:"VERIFIED",evidenceType:"SUPPLIER_REFERENCE",evidenceReference:"Synthetic supplier sheet"});
  r = await step({status:"WITHDRAWN",reviewReason:"Synthetic withdrawal"});
  await f.service.list(owner,itemId,{}); await f.service.events(owner,itemId,{});
  const allowed = new Set(["inventoryItem","deviceBrand","deviceModel","deviceBrandName","deviceModelName","compatibilitySet","itemCompatibility","compatibilityOperation","compatibilityEvent"]);
  assert.deepEqual([...new Set(f.reads)].filter(t => !allowed.has(t)),[]);
  assert.deepEqual(f.rows("inventoryItem"),item);
  const withdrawal = f.rows("compatibilityEvent").find(e => e.eventType === "STATUS_CHANGED" && object(e.after).status === "WITHDRAWN");
  assert.ok(withdrawal); assert.equal(object(withdrawal.before).status,"VERIFIED"); assert.equal(object(withdrawal.after).reviewReason,"Synthetic withdrawal");
  assert.equal(withdrawal.actorId,owner); assert.ok(withdrawal.occurredAt instanceof Date);
});

test("retired targets, stale version and relation from another item are protected", async () => {
  const {f,m} = await seed();
  f.rows("deviceModel")[0].retiredAt = new Date();
  await assert.rejects(f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id}),/DEVICE_RETIRED/);
  f.rows("deviceModel")[0].retiredAt = null;
  const added = await f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id});
  await assert.rejects(f.service.update(owner,itemId,added.compatibility.id,{operationId:randomUUID(),expectedSetVersion:99,expectedVersion:1,note:"X"}),/VERSION_CONFLICT/);
  await assert.rejects(f.service.update(other,foreignItem,added.compatibility.id,{operationId:randomUUID(),expectedSetVersion:1,expectedVersion:1,note:"X"}),/COMPATIBILITY_RESOURCE_NOT_FOUND/);
});

test("multiple brands per item and paginated dictionary remain scoped without inferring similar model names", async () => {
  const {f,m} = await seed();
  const b=await f.service.createBrand(owner,{operationId:randomUUID(),name:"Realme"});
  const m2=await f.service.createModel(owner,{operationId:randomUUID(),brandId:b.entity.id,name:"A58 5G"});
  await f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id});
  assert.equal((await f.service.list(owner,itemId,{})).compatibilities.length,1);
  await f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:1,modelId:m2.entity.id});
  const listed=await f.service.list(owner,itemId,{});assert.equal(listed.compatibilities.length,2);
  assert.deepEqual(new Set(listed.compatibilities.map(r=>r.model.brand.name)),new Set(["Oppo","Realme"]));
  for(let n=0;n<26;n++)await f.service.createBrand(owner,{operationId:randomUUID(),name:`Brand ${n}`});
  const first=await f.service.brands(owner,{}),second=await f.service.brands(owner,{page:"2"});
  assert.equal(first.items.length,25);assert.equal(first.hasMore,true);assert.equal(second.items.length,3);assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.items,...second.items].map(b=>b.id)).size,28);
  assert.deepEqual((await f.service.brands(other,{})).items,[]);
});

test("different concurrent operation keys cannot duplicate a pair; dictionary and review failures roll back all writes", async () => {
  const {f,m}=await seed();
  const results=await Promise.allSettled([1,2].map(()=>f.service.add(owner,itemId,{operationId:randomUUID(),expectedSetVersion:0,modelId:m.id})));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.rows("itemCompatibility").length,1);
  const row=f.rows("itemCompatibility")[0],before=structuredClone(row),receipts=f.rows("compatibilityOperation").length;
  f.fail("compatibilityEvent");
  await assert.rejects(f.service.update(owner,itemId,row.id,{operationId:randomUUID(),expectedSetVersion:1,expectedVersion:1,status:"VERIFIED",evidenceType:"SELLER_TEST",evidenceReference:"Test"}),/fixture-write-failure/);
  assert.deepEqual(f.rows("itemCompatibility")[0],before);assert.equal(f.rows("compatibilitySet")[0].version,1);assert.equal(f.rows("compatibilityOperation").length,receipts);
  f.fail("deviceBrandName");const count=f.rows("deviceBrand").length;
  await assert.rejects(f.service.createBrand(owner,{operationId:randomUUID(),name:"Partial failure"}),/fixture-write-failure/);
  assert.equal(f.rows("deviceBrand").length,count);
});

test("migration is additive, includes ownership FKs, canonical guards and immutable history without legacy updates", () => {
  const sql = readFileSync("prisma/migrations/20261124000000_private_item_compatibilities/migration.sql","utf8");
  assert.match(sql,/^BEGIN;/); assert.match(sql,/COMMIT;/);
  assert.match(sql,/FOREIGN KEY \("inventoryItemId", "ownerId"\).*REFERENCES "inventory_items"\("id", "userId"\)/);
  assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/); assert.match(sql,/device_model_one_canonical/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON compatibility_events/);
  assert.doesNotMatch(sql,/UPDATE\s+(?:"?products|"?inventory_items|"?Sale|"?orders)\b/i);
  assert.doesNotMatch(sql,/DROP\s+(TABLE|COLUMN|TYPE)/i);
});

test("HTTP: actual auth, IDOR, JSON limits, validation, safe failures and no changes to public routes", async () => {
  process.env.JWT_SECRET = "compatibility-tests-only-secret-at-least-32-bytes";
  const { makeCompatibilityRouter } = await import("../routes/compatibility.routes.js");
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const { apiErrorHandler } = await import("../middlewares/error.middleware.js");
  const {f,m} = await seed();
  const user: User = {id:owner,email:"fixture@example.invalid",passwordHash:null,googleId:null,emailVerifiedAt:null,sessionVersion:0,closedAt:null,role:"USER",name:null,createdAt:new Date(),updatedAt:new Date()};
  const app = express(); app.use("/api",makeCompatibilityRouter(makeCompatibilityController(f.service),makeAuthenticate(async id => id === owner ? user : null)));
  app.get("/api/public-fixture", (_req,res) => res.json({public:true})); app.use(apiErrorHandler);
  const server = app.listen(0,"127.0.0.1"); await once(server,"listening"); const address=server.address(); assert.ok(address&&typeof address!=="string");
  const token=generateToken({userId:owner,email:user.email});
  const request = (path:string,method="GET",body?:unknown,auth=true) => fetch(`http://127.0.0.1:${address.port}/api${path}`,{method,headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try {
    assert.equal((await request("/device-brands","GET",undefined,false)).status,401);
    assert.equal((await request("/api","GET",undefined,false)).status,404);
    assert.equal((await request("/public-fixture","GET",undefined,false)).status,200);
    const empty=await request(`/inventory/items/${itemId}/compatibilities`); assert.equal(empty.status,200); assert.equal(empty.headers.get("cache-control"),"private, no-store");
    assert.equal((await request(`/inventory/items/${foreignItem}/compatibilities`)).status,404);
    for(const path of ["/device-brands?status=active&status=all","/device-models?brandId=bad",`/inventory/items/${itemId}/compatibilities?ownerId=${other}`]) assert.equal((await request(path)).status,400);
    assert.equal((await request("/device-brands","POST",{operationId:randomUUID(),name:"x".repeat(17000)})).status,413);
    assert.equal((await request("/device-brands","POST",{operationId:randomUUID(),name:"X",ownerId:other})).status,400);
    const command={operationId:randomUUID(),expectedSetVersion:0,modelId:m.id};
    assert.equal((await request(`/inventory/items/${itemId}/compatibilities`,"POST",command)).status,201);
    assert.equal((await request(`/inventory/items/${itemId}/compatibilities`,"POST",command)).status,200);
    f.fail("compatibilityEvent"); const failure=await request("/device-brands","POST",{operationId:randomUUID(),name:"Failure"});
    assert.equal(failure.status,503); assert.doesNotMatch(await failure.text(),/fixture-write-failure/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
