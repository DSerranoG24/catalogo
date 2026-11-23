import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import { Prisma, type Customer, type User } from "@prisma/client";
import { prisma } from "../config/prisma";
import { customerListSchema, createCustomerSchema, updateCustomerSchema } from "../schemas/customer.schema";
import { customerListWhere, makeCustomerRepository } from "../repositories/customer.repository";
import { makeCustomerService } from "../services/customer.service";
import { makeCustomerController } from "../controllers/customer.controller";

const ownerA = "00000000-0000-4000-8000-000000000001";
const ownerB = "00000000-0000-4000-8000-000000000002";
const missingId = "00000000-0000-4000-8000-000000000099";
const valid = { fullName: "Cliente de prueba", phone: "3000000000", email: "customer@example.invalid", address: "Dirección de prueba", notes: "Nota de prueba" };

function user(id: string): User {
  return { id, email: "owner@example.invalid", passwordHash: null, googleId: null, emailVerifiedAt: null, sessionVersion: 0,
    closedAt: null, role: "USER", name: null, createdAt: new Date(0), updatedAt: new Date(0) };
}

// No connections: unexpected delegates, unscoped queries and physical deletes fail closed.
function fixture() {
  let rows: Customer[] = [];
  const users = [user(ownerA), user(ownerB)];
  const locks: string[] = [];
  let failure = false, deletionCalls = 0, reads = 0;
  function matches(row: Customer, where: Prisma.CustomerWhereInput): boolean {
    assert.equal(typeof where.ownerId, "string", "Every customer query must be owner-scoped");
    if (where.ownerId !== row.ownerId) return false;
    if (typeof where.id === "string" && row.id !== where.id) return false;
    if (where.id && typeof where.id === "object" && typeof where.id.not === "string" && row.id === where.id.not) return false;
    if (typeof where.phone === "string" && row.phone !== where.phone) return false;
    if (where.archivedAt === null && row.archivedAt !== null) return false;
    if (where.archivedAt && typeof where.archivedAt === "object" && "not" in where.archivedAt && where.archivedAt.not === null && row.archivedAt === null) return false;
    if (where.OR) return where.OR.some(clause => {
      for (const key of ["fullName", "phone"] as const) {
        const filter = clause[key];
        if (filter && typeof filter === "object" && typeof filter.contains === "string") {
          const term = filter.contains.replace(/\\([\\%_])/g, "$1");
          return row[key].toLowerCase().includes(term.toLowerCase());
        }
      }
      throw new Error("Unexpected search clause");
    });
    return true;
  }
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = structuredClone(rows);
      try { return await fn(db); } catch (error) { rows = before; throw error; }
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(sql.join("?"), /FROM users.*closedAt.*FOR SHARE/);
      return users.filter(owner => owner.id === values[0] && owner.closedAt === null).map(owner => ({ id: owner.id }));
    };
    if (key === "$executeRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(sql.join("?"), /pg_advisory_xact_lock/);
      assert.equal(typeof values[0], "string"); assert.equal(typeof values[1], "string");
      locks.push(values.join("|")); return 1;
    };
    if (key === "customer") return {
      create: async (args: Prisma.CustomerCreateArgs) => {
        assert.equal(typeof args.data.ownerId, "string");
        const ownerId = args.data.ownerId;
        assert.ok(ownerId);
        const row: Customer = { id: randomUUID(), ownerId, fullName: args.data.fullName, phone: args.data.phone,
          email: args.data.email ?? null, address: args.data.address ?? null, notes: args.data.notes ?? null,
          archivedAt: null, createdAt: new Date(rows.length * 1000), updatedAt: new Date(rows.length * 1000) };
        rows.push(row); return structuredClone(row);
      },
      findMany: async (args: Prisma.CustomerFindManyArgs) => {
        reads++; if (failure) throw new Error("private database details customer@example.invalid");
        assert.ok(args.where); assert.ok(args.take && args.take <= 26);
        assert.deepEqual(args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
        return structuredClone(rows.filter(row => matches(row, args.where ?? {})).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(args.skip ?? 0, (args.skip ?? 0) + args.take));
      },
      findFirst: async (args: Prisma.CustomerFindFirstArgs) => {
        assert.ok(args.where); return structuredClone(rows.find(row => matches(row, args.where ?? {})) ?? null);
      },
      findFirstOrThrow: async (args: Prisma.CustomerFindFirstOrThrowArgs) => {
        assert.ok(args.where); const row = rows.find(row => matches(row, args.where ?? {})); assert.ok(row); return structuredClone(row);
      },
      updateMany: async (args: Prisma.CustomerUpdateManyArgs) => {
        assert.ok(args.where);
        let count = 0;
        for (const row of rows.filter(row => matches(row, args.where ?? {}))) {
          const patch = args.data;
          for (const field of ["fullName", "phone"] as const) if (typeof patch[field] === "string") row[field] = patch[field];
          for (const field of ["email", "address", "notes"] as const) {
            const value = patch[field]; if (value === null || typeof value === "string") row[field] = value;
          }
          if (patch.archivedAt === null || patch.archivedAt instanceof Date) row.archivedAt = patch.archivedAt;
          row.updatedAt = new Date(row.updatedAt.getTime() + 1); count++;
        }
        return { count };
      },
      delete: async () => { deletionCalls++; throw new Error("Physical deletion forbidden"); },
      deleteMany: async () => { deletionCalls++; throw new Error("Physical deletion forbidden"); },
    };
    throw new Error("Unexpected database operation");
  } });
  return { db, users, locks, get rows() { return rows; }, get deletionCalls() { return deletionCalls; }, get reads() { return reads; }, fail() { failure = true; } };
}

async function withApi(run: (context: {
  store: ReturnType<typeof fixture>;
  request: (path: string, method?: string, body?: unknown, owner?: string | null) => Promise<Response>;
}) => Promise<void>) {
  process.env.JWT_SECRET = "customer-test-only-signing-secret-at-least-32-bytes";
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const { makeCustomerRouter } = await import("./customer.routes.js");
  const store = fixture();
  const authentication = makeAuthenticate(async id => store.users.find(owner => owner.id === id) ?? null);
  const controller = makeCustomerController(makeCustomerService(makeCustomerRepository(store.db)));
  const app = express(); app.use(express.json()); app.use("/api/customers", makeCustomerRouter(controller, authentication));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await run({ store, request: (path, method = "GET", body, owner = ownerA) => fetch(`http://127.0.0.1:${address.port}/api/customers${path}`, {
      method, headers: { "Content-Type": "application/json", ...(owner ? { Authorization: `Bearer ${generateToken({ userId: owner, email: "owner@example.invalid" })}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("customer schemas normalize spaces, phones and optional empty fields", () => {
  assert.deepEqual(createCustomerSchema.parse({ fullName: "  Ana  María\n Pérez  ", phone: " +57 (300) 000-0000 ", email: "", address: "  ", notes: null }), {
    fullName: "Ana María Pérez", phone: "573000000000", email: null, address: null, notes: null,
  });
  assert.equal(createCustomerSchema.parse({ fullName: " X ", phone: "1234567" }).fullName, "X");
  assert.equal(updateCustomerSchema.safeParse({}).success, false);
  assert.equal(updateCustomerSchema.safeParse({ fullName: undefined }).success, false);
});

test("invalid inputs, forged owners and archive state are rejected without writes", async () => withApi(async ({ request, store }) => {
  for (const input of [
    { ...valid, fullName: "  " }, { ...valid, fullName: "x".repeat(161) }, { ...valid, fullName: "A\u0000B" },
    { ...valid, phone: "" }, { ...valid, phone: "   " }, { ...valid, phone: "abc3000000000" }, { ...valid, phone: "123" },
    { ...valid, phone: "1".repeat(16) }, { ...valid, phone: "++3000000000" }, { ...valid, phone: 3000000000 },
    { ...valid, phone: "(3000000000" }, { ...valid, phone: "3000000000)" }, { ...valid, phone: "300--0000000" },
    { ...valid, email: "not-an-email" }, { ...valid, email: "x".repeat(255) }, { ...valid, address: "x".repeat(301) },
    { ...valid, notes: "x".repeat(2001) }, { ...valid, notes: "a\u0000b" }, { ...valid, ownerId: ownerB },
    { ...valid, archivedAt: new Date().toISOString() }, { ...valid, id: missingId }, { ...valid, active: false },
  ]) {
    const response = await request("", "POST", input); assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_CUSTOMER_INPUT");
  }
  assert.equal(store.rows.length, 0);
}));

test("valid HTTP creation uses authenticated owner and returns private normalized data", async () => withApi(async ({ request, store }) => {
  const response = await request("", "POST", { ...valid, fullName: "  Cliente   de prueba  ", phone: "(300) 000-0000" });
  assert.equal(response.status, 201); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.customer.ownerId, ownerA); assert.equal(body.customer.fullName, valid.fullName);
  assert.equal(body.customer.phone, "3000000000"); assert.equal(body.customer.archivedAt, null);
  assert.ok(body.customer.id); assert.ok(body.customer.createdAt); assert.ok(body.customer.updatedAt); assert.deepEqual(body.warnings, []);
  assert.equal(store.rows.length, 1);
  assert.deepEqual(store.locks, [`customer-phone-v1:${ownerA}|3000000000`]);
}));

test("same names are allowed; phone matches warn for own active/archived customers without blocking", async () => withApi(async ({ request, store }) => {
  const original = await (await request("", "POST", valid)).json();
  const sameName = await request("", "POST", { ...valid, phone: "3000000001" }); assert.equal(sameName.status, 201);
  assert.deepEqual((await sameName.json()).warnings, []);
  await request(`/${original.customer.id}/archive`, "POST");
  const samePhone = await request("", "POST", { ...valid, fullName: "Otro cliente", phone: "300 000-0000" });
  assert.equal(samePhone.status, 201); assert.equal((await samePhone.json()).warnings[0].code, "CUSTOMER_PHONE_MATCH");
  const again = await request("", "POST", valid); assert.equal(again.status, 201);
  assert.equal((await again.json()).warnings[0].code, "CUSTOMER_PHONE_MATCH");
  const foreign = await request("", "POST", valid, ownerB); assert.equal(foreign.status, 201);
  assert.deepEqual((await foreign.json()).warnings, []); assert.equal(store.rows.length, 5);
}));

test("list and detail isolate owners; foreign and absent mutations are indistinguishable 404s", async () => withApi(async ({ request, store }) => {
  const own = await (await request("", "POST", valid)).json();
  const other = await (await request("", "POST", { ...valid, fullName: "Otro propietario" }, ownerB)).json();
  const list = await (await request("?status=all")).json(); assert.equal(list.customers.length, 1); assert.equal(list.customers[0].id, own.customer.id);
  assert.equal((await request(`/${own.customer.id}`)).status, 200);
  const before = structuredClone(store.rows);
  for (const id of [other.customer.id, missingId]) for (const [method, suffix, body] of [
    ["GET", "", undefined], ["PATCH", "", { fullName: "Changed" }], ["POST", "/archive", undefined], ["POST", "/reactivate", undefined],
  ] as const) {
    const response = await request(`/${id}${suffix}`, method, body);
    assert.equal(response.status, 404); assert.equal((await response.json()).error, "CUSTOMER_NOT_FOUND");
  }
  assert.deepEqual(store.rows, before);
}));

test("search supports case-insensitive names, formatted/partial phones and literal wildcards", async () => withApi(async ({ request }) => {
  await request("", "POST", { ...valid, fullName: "Ana María" });
  await request("", "POST", { ...valid, fullName: "Otro cliente", phone: "3110000000" });
  await request("", "POST", { ...valid, fullName: "Ana María" }, ownerB);
  for (const q of ["aNA", "  Ana   María ", "(300) 000-0000", "300", "+3000000000"]) {
    const body = await (await request(`?q=${encodeURIComponent(q)}`)).json(); assert.equal(body.customers.length, 1); assert.equal(body.customers[0].fullName, "Ana María");
  }
  assert.deepEqual((await (await request("?q=missing")).json()).customers, []);
  assert.deepEqual((await (await request("?q=%25")).json()).customers, []);
  const where = customerListWhere(ownerA, customerListSchema.parse({ q: "%_\\" }));
  assert.equal(where.ownerId, ownerA);
  assert.deepEqual(where.OR, [{ fullName: { contains: "\\%\\_\\\\", mode: "insensitive" } }]);
}));

test("partial updates normalize values, clear optional fields and warn on another customer's phone", async () => withApi(async ({ request, store }) => {
  const a = await (await request("", "POST", valid)).json();
  const b = await (await request("", "POST", { fullName: "B", phone: "3000000001" })).json();
  const response = await request(`/${a.customer.id}`, "PATCH", { fullName: "  Nuevo  nombre ", email: "", address: null, notes: "  Nueva nota  " });
  assert.equal(response.status, 200); const updated = await response.json();
  assert.equal(updated.customer.fullName, "Nuevo nombre"); assert.equal(updated.customer.phone, valid.phone);
  assert.equal(updated.customer.email, null); assert.equal(updated.customer.address, null); assert.equal(updated.customer.notes, "Nueva nota");
  assert.notEqual(updated.customer.updatedAt, a.customer.updatedAt); assert.equal(updated.customer.createdAt, a.customer.createdAt);
  assert.deepEqual((await (await request(`/${a.customer.id}`, "PATCH", { phone: valid.phone })).json()).warnings, []);
  const match = await request(`/${b.customer.id}`, "PATCH", { phone: valid.phone });
  assert.equal(match.status, 200); assert.equal((await match.json()).warnings[0].code, "CUSTOMER_PHONE_MATCH");
  const before = structuredClone(store.rows);
  for (const input of [{}, { ownerId: ownerB }, { archivedAt: null }, { email: "bad" }, { phone: "" }, { fullName: " " }]) assert.equal((await request(`/${a.customer.id}`, "PATCH", input)).status, 400);
  assert.deepEqual(store.rows, before);
}));

test("archive/reactivate are idempotent, preserve the record and filter list state", async () => withApi(async ({ request, store }) => {
  const a = await (await request("", "POST", valid)).json();
  const path = `/${a.customer.id}`;
  const archived = await (await request(`${path}/archive`, "POST")).json(); assert.ok(archived.customer.archivedAt);
  assert.deepEqual((await (await request(`${path}/archive`, "POST")).json()).customer, archived.customer);
  assert.equal((await (await request("")).json()).customers.length, 0);
  assert.equal((await (await request("?status=archived")).json()).customers.length, 1);
  assert.equal((await (await request("?status=all")).json()).customers.length, 1);
  assert.equal((await request(path)).status, 200);
  const reactivated = await (await request(`${path}/reactivate`, "POST")).json(); assert.equal(reactivated.customer.archivedAt, null);
  assert.deepEqual((await (await request(`${path}/reactivate`, "POST")).json()).customer, reactivated.customer);
  assert.equal((await (await request("")).json()).customers.length, 1);
  assert.equal(store.rows.length, 1); assert.equal(store.rows[0]?.phone, valid.phone);
}));

test("physical deletion is unavailable for active and archived customers", async () => withApi(async ({ request, store }) => {
  const a = await (await request("", "POST", valid)).json();
  for (const archive of [false, true]) {
    if (archive) await request(`/${a.customer.id}/archive`, "POST");
    const response = await request(`/${a.customer.id}`, "DELETE");
    assert.equal(response.status, 405); assert.equal((await response.json()).error, "CUSTOMER_DELETION_NOT_ALLOWED");
  }
  assert.equal(store.deletionCalls, 0); assert.equal(store.rows.length, 1);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model Customer\s*\{[^}]*owner User @relation\(fields: \[ownerId\], references: \[id\], onDelete: Restrict\)/s);
}));

test("list is bounded and invalid/repeated query parameters fail validation", async () => withApi(async ({ request, store }) => {
  const repository = makeCustomerRepository(store.db);
  for (let i = 0; i < 26; i++) await repository.create(ownerA, createCustomerSchema.parse({ fullName: `Customer ${i}`, phone: `30000000${String(i).padStart(2, "0")}` }));
  const first = await (await request("")).json(); const second = await (await request("?page=2")).json();
  assert.equal(first.customers.length, 25); assert.equal(first.pageSize, 25); assert.equal(first.hasMore, true);
  assert.equal(second.customers.length, 1); assert.equal(second.hasMore, false);
  assert.equal(first.customers.some((row: { id: string }) => row.id === second.customers[0].id), false);
  for (const query of ["page=0", "page=-1", "page=1.5", "page=10001", "page=1&page=2", "q=x&q=y", "status=bad", "ownerId=x", "pageSize=1000", `q=${"x".repeat(161)}`]) assert.equal((await request(`?${query}`)).status, 400);
  assert.equal((await request("/invalid-id")).status, 400);
}));

test("all customer operations require authentication and reject closed or stale sessions", async () => withApi(async ({ request, store }) => {
  for (const [method, path] of [["GET", ""], ["POST", ""], ["GET", `/${missingId}`], ["PATCH", `/${missingId}`], ["POST", `/${missingId}/archive`], ["POST", `/${missingId}/reactivate`], ["DELETE", `/${missingId}`]]) {
    const response = await request(path, method, method === "POST" || method === "PATCH" ? valid : undefined, null);
    assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  const owner = store.users[0]; assert.ok(owner);
  owner.closedAt = new Date(); assert.equal((await request("")).status, 401);
  owner.closedAt = null; owner.sessionVersion = 1; assert.equal((await request("")).status, 401);
  assert.equal((await request("", "GET", undefined, missingId)).status, 401);
  assert.equal(store.reads, 0); assert.equal(store.rows.length, 0);
}));

test("repository denies writes for accounts closed after authentication; errors expose no private detail", async () => withApi(async ({ request, store }) => {
  const owner = store.users[0]; assert.ok(owner); owner.closedAt = new Date();
  await assert.rejects(makeCustomerRepository(store.db).create(ownerA, createCustomerSchema.parse(valid)), /ACCOUNT_CLOSED/);
  assert.equal(store.rows.length, 0); owner.closedAt = null;
  store.fail(); const response = await request(""); assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: "CUSTOMER_OPERATION_FAILED", message: "No se pudo completar la operación de clientes. Puedes reintentar." });
}));
