import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "../config/prisma";
import { makeExpenseRepository, expenseCommandHash, SEED_CATEGORIES, CATEGORY_QUOTA } from "../repositories/expense.repository";
import { makeExpenseService } from "./expense.service";
import { makeExpenseController } from "../controllers/expense.controller";
import { createExpenseSchema, reclassifyExpenseSchema, voidExpenseSchema, expenseListSchema, normalizeCategoryName } from "../schemas/expense.schema";
import { bogotaToday, minExpenseDate, isAllowedExpenseDate } from "./expense-dates";

// In-memory double: every query must be scoped by owner, transactions roll back as a whole,
// unique indexes (including (ownerId, requestId)) raise P2002. PostgreSQL itself is rehearsed
// in src/scripts/verify-expenses-postgres.ts.
const A = randomUUID(), B = randomUUID();
const NOW = new Date("2026-11-24T17:00:00.000Z"); // 12:00 in Bogotá
type Row = Record<string, any>;
const tick = () => new Promise(resolve => setImmediate(resolve));
const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });

function fixture() {
  let t: Record<string, Row[]> = { expenseCategory: [], expense: [], expenseOperation: [], expenseEvent: [] };
  const closed = new Set<string>(); let fail = ""; let tail: Promise<void> = Promise.resolve(); let seq = 0;
  const cmp = (a: any, b: any) => a instanceof Date ? a.getTime() - b.getTime() : a < b ? -1 : a > b ? 1 : 0;
  const same = (a: any, b: any) => a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  function match(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((w: Row) => match(row, w));
      if (key === "ownerId_operationId" || key === "id_ownerId") return match(row, value);
      if (value !== null && typeof value === "object" && !(value instanceof Date)) {
        if ("in" in value) return value.in.includes(row[key]);
        if ("not" in value) return value.not === null ? row[key] !== null && row[key] !== undefined : !same(row[key], value.not);
        return (value.gte === undefined || cmp(row[key], value.gte) >= 0) && (value.lte === undefined || cmp(row[key], value.lte) <= 0)
          && (value.lt === undefined || cmp(row[key], value.lt) < 0) && (value.gt === undefined || cmp(row[key], value.gt) > 0);
      }
      return value === null ? row[key] === null || row[key] === undefined : same(row[key], value);
    });
  }
  const scoped = (table: string, where: Row) => assert.equal(typeof (where?.ownerId_operationId ?? where?.id_ownerId ?? where)?.ownerId, "string", `${table}: query not scoped by owner`);
  const shape = (table: string, row: Row, include?: Row) => {
    const out = { ...row };
    if (table === "expense" && include?.category) { const c = t.expenseCategory.find(x => x.id === row.categoryId && x.ownerId === row.ownerId); out.category = c ? { name: c.name, archivedAt: c.archivedAt } : null; }
    if (table === "expense" && include?.replacedBy) out.replacedBy = t.expense.filter(e => e.replacesExpenseId === row.id).map(e => ({ id: e.id }));
    return structuredClone(out);
  };
  const order = (rows: Row[], orderBy: any) => [...rows].sort((a, b) => { for (const o of (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [])) for (const [k, dir] of Object.entries(o)) { const c = cmp(a[k], b[k]); if (c) return dir === "desc" ? -c : c; } return 0; });
  const duplicate = (target: string[]) => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target } });
  function unique(table: string, row: Row) {
    const others = t[table].filter(r => r !== row);
    if (table === "expenseCategory") {
      if (others.some(r => r.ownerId === row.ownerId && r.normalizedKey === row.normalizedKey)) throw duplicate(["ownerId", "normalizedKey"]);
      if (row.seedKey && others.some(r => r.ownerId === row.ownerId && r.seedKey === row.seedKey)) throw duplicate(["ownerId", "seedKey"]);
    }
    if (table === "expenseOperation") {
      if (others.some(r => r.ownerId === row.ownerId && r.operationId === row.operationId)) throw duplicate(["ownerId", "operationId"]);
      if (others.some(r => r.ownerId === row.ownerId && r.requestId === row.requestId)) throw duplicate(["ownerId", "requestId"]);
    }
    if (table === "expense" && row.replacesExpenseId && others.some(r => r.replacesExpenseId === row.replacesExpenseId)) throw duplicate(["replacesExpenseId"]);
  }
  const defaults = (table: string): Row => {
    const at = new Date(NOW.getTime() + ++seq);
    if (table === "expenseCategory") return { id: randomUUID(), seedKey: null, position: 0, archivedAt: null, version: 1, createdAt: at, updatedAt: at };
    if (table === "expense") return { id: randomUUID(), status: "CONFIRMED", source: "MANUAL", templateId: null, occurrenceDate: null, suggestedAmount: null, currency: "COP", taxMode: "NOT_MANAGED",
      categoryNameSnapshot: null, paymentMethodNote: null, paymentReference: null, supplierName: null, replacesExpenseId: null, recordedAt: at, confirmedAt: null, skippedAt: null, skipReason: null, voidedAt: null, voidReason: null, version: 1, updatedAt: at };
    if (table === "expenseEvent") return { id: randomUUID(), occurredAt: at };
    return { createdAt: at };
  };
  const delegate = (table: string) => ({
    async findFirst({ where, include }: Row) { scoped(table, where); await tick(); const row = t[table].find(r => match(r, where)); return row ? shape(table, row, include) : null; },
    async findUnique({ where }: Row) { scoped(table, where); await tick(); const row = t[table].find(r => match(r, where)); return row ? shape(table, row) : null; },
    async findMany({ where, include, orderBy, take }: Row) { scoped(table, where); await tick(); return order(t[table].filter(r => match(r, where)), orderBy).slice(0, take ?? Infinity).map(r => shape(table, r, include)); },
    async count({ where }: Row) { scoped(table, where); return t[table].filter(r => match(r, where)).length; },
    async groupBy({ by, where, _sum }: Row) {
      scoped(table, where); const groups = new Map<unknown, Row>();
      for (const r of t[table].filter(x => match(x, where))) {
        const g = groups.get(r[by[0]]) ?? { [by[0]]: r[by[0]], _sum: Object.fromEntries(Object.keys(_sum ?? {}).map(k => [k, null])), _count: { _all: 0 } };
        for (const k of Object.keys(_sum ?? {})) if (r[k] !== null && r[k] !== undefined) g._sum[k] = (g._sum[k] ?? 0n) + r[k];
        g._count._all++; groups.set(r[by[0]], g);
      }
      return [...groups.values()];
    },
    async create({ data, include }: Row) {
      if (fail === table || (fail.startsWith(`${table}:`) && data.eventType === fail.split(":")[1])) throw new Error("fixture-write-failure");
      assert.equal(typeof data.ownerId, "string");
      const row: Row = { ...defaults(table), ...data };
      for (const k of ["before"]) if (row[k] === Prisma.DbNull) row[k] = null;
      unique(table, row); t[table].push(row); return shape(table, row, include);
    },
    async update({ where, data, include }: Row) {
      scoped(table, where); const row = t[table].find(r => match(r, where)); assert.ok(row, `${table}: update target not found for this owner`);
      for (const [k, v] of Object.entries(data)) row[k] = v !== null && typeof v === "object" && "increment" in (v as Row) ? row[k] + (v as Row).increment : v;
      row.updatedAt = new Date(); unique(table, row); return shape(table, row, include);
    },
  });
  const db: any = {
    async $transaction(work: (tx: any) => Promise<unknown>) {
      const previous = tail; let release = () => {}; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const before = structuredClone(t);
      try { return await work(db); } catch (error) { t = before; throw error; } finally { release(); }
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (/FROM users/.test(sql)) { assert.match(sql, /FOR SHARE/); return closed.has(values[0] as string) ? [] : [{ id: values[0] }]; }
      if (/FOR UPDATE/.test(sql)) { assert.equal(typeof values[1], "string", "row lock scoped by owner"); return []; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray) { assert.match(strings.join("?"), /pg_advisory_xact_lock\(hashtext\('expenses-v1'\)/); return 1; },
    expenseCategory: delegate("expenseCategory"), expense: delegate("expense"), expenseOperation: delegate("expenseOperation"), expenseEvent: delegate("expenseEvent"),
  };
  const service = makeExpenseService(makeExpenseRepository(db as unknown as typeof prisma, () => NOW));
  return { service, rows: (table: string) => t[table], close: (owner: string) => closed.add(owner), fail: (what: string) => { fail = what; }, counts: () => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.length])) };
}
type F = ReturnType<typeof fixture>;
const seed = async (f: F, owner = A) => (await f.service.seedCategories(owner, keys()) as any).categories as Row[];
const categoryId = (cats: Row[], name: string) => cats.find(c => c.name === name)!.id as string;
const expenseBody = (catId: string, extra: Row = {}) => ({ ...keys(), expenseDate: "2026-11-20", amount: "150000", categoryId: catId, paymentMethod: "CASH", description: "Arriendo local", ...extra });
async function create(f: F, owner: string, catId: string, extra: Row = {}) { return (await f.service.createExpense(owner, expenseBody(catId, extra)) as any).expense as Row; }

test("schemas: amounts as digit strings up to 1e12, Bogotá dates in a 5-year window, OTHER note, private reference, strict fields", () => {
  const ok = (body: Row) => createExpenseSchema.safeParse(body).success;
  const base = expenseBody(randomUUID());
  assert.ok(ok(base)); assert.ok(ok({ ...base, amount: "1000000000000" }));
  for (const amount of ["0", "-1", "1.5", "1.000", "1000000000001", 150000, "0150"]) assert.equal(ok({ ...base, amount }), false, String(amount));
  assert.equal(ok({ ...base, paymentMethod: "OTHER" }), false, "OTHER needs a note");
  assert.ok(ok({ ...base, paymentMethod: "OTHER", paymentMethodNote: "Bancolombia a la mano" }));
  assert.equal(ok({ ...base, paymentMethodNote: "Nota sin OTHER" }), false);
  assert.equal(ok({ ...base, paymentReference: "x".repeat(101) }), false); assert.ok(ok({ ...base, paymentReference: "NEQ-123" }));
  for (const extra of [{ ownerId: B }, { status: "VOIDED" }, { taxMode: "IVA" }, { recordedAt: NOW.toISOString() }]) assert.equal(ok({ ...base, ...extra }), false, JSON.stringify(extra));
  assert.equal(ok({ ...base, expenseDate: "2026-02-30" }), false);
  for (const field of [{ amount: "1" }, { expenseDate: "2026-11-01" }, { paymentMethod: "CARD" }, { supplierName: "X" }, { paymentReference: "R" }])
    assert.equal(reclassifyExpenseSchema.safeParse({ ...keys(), expectedVersion: 1, description: "ok", ...field }).success, false, `reclassify must reject ${Object.keys(field)[0]}`);
  assert.equal(reclassifyExpenseSchema.safeParse({ ...keys(), expectedVersion: 1 }).success, false, "at least one change");
  assert.ok(voidExpenseSchema.safeParse({ ...keys(), expectedVersion: 1, reason: "Error de digitación", replacement: { expenseDate: "2026-11-20", amount: "1", categoryId: randomUUID(), paymentMethod: "CASH", description: "x" } }).success);
  assert.equal(expenseListSchema.safeParse({ from: "2025-01-01", to: "2026-01-02" }).success, false, "range over 366 days");
  assert.equal(bogotaToday(new Date("2026-11-25T03:00:00Z")), "2026-11-24", "22:00 in Bogotá is still the 24th");
  assert.equal(minExpenseDate("2028-02-29"), "2023-02-28");
  assert.ok(isAllowedExpenseDate("2021-11-24", NOW)); assert.equal(isAllowedExpenseDate("2021-11-23", NOW), false); assert.equal(isAllowedExpenseDate("2026-11-25", NOW), false);
  assert.equal(normalizeCategoryName("  Nómina   y HONORARIOS "), "nómina y honorarios");
  const k = keys(); assert.equal(expenseCommandHash("X", "r", { ...k, a: 1 }), expenseCommandHash("X", "r", { ...k, requestId: randomUUID(), a: 1 }), "hash excludes requestId");
});

test("seed: once per account, includes Nómina y honorarios, skips existing names, keeps renamed/archived seeds; concurrent seeds do not duplicate", async () => {
  const f = fixture();
  await f.service.createCategory(A, { ...keys(), name: "ARRIENDO" });
  const [first, second] = await Promise.all([f.service.seedCategories(A, keys()), f.service.seedCategories(A, keys())]) as any[];
  assert.equal(first.created + second.created, SEED_CATEGORIES.length - 1, "the existing 'Arriendo' blocks its seed");
  const cats = await seed(f);
  assert.ok(cats.some(c => c.name === "Nómina y honorarios")); assert.equal(cats.filter(c => c.name.toLowerCase() === "arriendo").length, 1);
  const payroll = cats.find(c => c.seedKey === "payroll-fees")!;
  await f.service.updateCategory(A, payroll.id, { ...keys(), expectedVersion: payroll.version, name: "Personal" });
  const other = cats.find(c => c.seedKey === "other")!;
  await f.service.archiveCategory(A, other.id, { ...keys(), expectedVersion: other.version });
  assert.equal((await f.service.seedCategories(A, keys()) as any).created, 0, "renamed and archived seeds are not recreated");
  assert.equal(f.rows("expenseCategory").filter(c => c.ownerId === A).length, SEED_CATEGORIES.length);
});

test("categories: name conflict (also archived) returns the existing id, quota of 100, rename conflict, archive/reactivate with versions and events", async () => {
  const f = fixture(); const cats = await seed(f);
  const rent = cats.find(c => c.seedKey === "rent")!;
  await f.service.archiveCategory(A, rent.id, { ...keys(), expectedVersion: rent.version });
  await assert.rejects(f.service.createCategory(A, { ...keys(), name: " arriendo " }), (e: any) => e.code === "EXPENSE_CATEGORY_NAME_CONFLICT" && e.details.existingId === rent.id && e.details.archived === true);
  await assert.rejects(f.service.updateCategory(A, cats[1].id, { ...keys(), expectedVersion: cats[1].version, name: "Arriendo" }), /EXPENSE_CATEGORY_NAME_CONFLICT/);
  await assert.rejects(f.service.archiveCategory(A, cats[1].id, { ...keys(), expectedVersion: 99 }), /VERSION_CONFLICT/);
  const reactivated = (await f.service.reactivateCategory(A, rent.id, { ...keys(), expectedVersion: rent.version + 1 }) as any).category;
  assert.equal(reactivated.archivedAt, null);
  for (let i = f.rows("expenseCategory").length; i < CATEGORY_QUOTA; i++) await f.service.createCategory(A, { ...keys(), name: `Categoría ${i}` });
  await assert.rejects(f.service.createCategory(A, { ...keys(), name: "Una más" }), /EXPENSE_CATEGORY_QUOTA/);
  assert.ok(f.rows("expenseEvent").some(e => e.eventType === "ARCHIVED") && f.rows("expenseEvent").some(e => e.eventType === "REACTIVATED"));
  assert.deepEqual((await f.service.listCategories(A, { status: "archived" }) as any).categories, []);
});

test("expenses: create CONFIRMED with snapshot, date window, archived category, reclassify category/description/note with RECLASSIFIED before/after", async () => {
  const f = fixture(); const cats = await seed(f);
  const e = await create(f, A, categoryId(cats, "Arriendo"), { paymentReference: "TRX-1" });
  assert.equal(e.status, "CONFIRMED"); assert.equal(e.amount, "150000"); assert.equal(e.categoryNameSnapshot, "Arriendo"); assert.equal(e.paymentReference, "TRX-1"); assert.equal(e.taxMode, "NOT_MANAGED");
  await assert.rejects(f.service.createExpense(A, expenseBody(categoryId(cats, "Arriendo"), { expenseDate: "2026-11-25" })), /INVALID_EXPENSE_INPUT/, "future date");
  await assert.rejects(f.service.createExpense(A, expenseBody(categoryId(cats, "Arriendo"), { expenseDate: "2021-11-23" })), /INVALID_EXPENSE_INPUT/, "older than five years");
  const archivedCat = cats.find(c => c.seedKey === "other")!;
  await f.service.archiveCategory(A, archivedCat.id, { ...keys(), expectedVersion: archivedCat.version });
  await assert.rejects(f.service.createExpense(A, expenseBody(archivedCat.id)), /EXPENSE_CATEGORY_ARCHIVED/);
  const moved = (await f.service.reclassifyExpense(A, e.id, { ...keys(), expectedVersion: 1, categoryId: categoryId(cats, "Servicios públicos"), description: "Servicios del local" }) as any).expense;
  assert.equal(moved.categoryNameSnapshot, "Servicios públicos"); assert.equal(moved.version, 2); assert.equal(moved.amount, "150000");
  const event = f.rows("expenseEvent").find(x => x.eventType === "RECLASSIFIED")!;
  assert.deepEqual([event.before.categoryName, event.after.categoryName, event.before.description, event.after.description], ["Arriendo", "Servicios públicos", "Arriendo local", "Servicios del local"]);
  await assert.rejects(f.service.reclassifyExpense(A, e.id, { ...keys(), expectedVersion: 2, paymentMethodNote: "Nota" }), /INVALID_EXPENSE_INPUT/, "CASH has no note");
  await assert.rejects(f.service.reclassifyExpense(A, e.id, { ...keys(), expectedVersion: 2, categoryId: archivedCat.id }), /EXPENSE_CATEGORY_ARCHIVED/);
  await assert.rejects(f.service.reclassifyExpense(A, e.id, { ...keys(), expectedVersion: 1, description: "x" }), /VERSION_CONFLICT/);
  const other = await create(f, A, categoryId(cats, "Arriendo"), { paymentMethod: "OTHER", paymentMethodNote: "Bancolombia a la mano" });
  const noted = (await f.service.reclassifyExpense(A, other.id, { ...keys(), expectedVersion: 1, paymentMethodNote: "Corresponsal bancario" }) as any).expense;
  assert.equal(noted.paymentMethodNote, "Corresponsal bancario");
  const noteEvent = f.rows("expenseEvent").filter(x => x.eventType === "RECLASSIFIED").at(-1)!;
  assert.deepEqual([noteEvent.before.paymentMethodNote, noteEvent.after.paymentMethodNote], ["Bancolombia a la mano", "Corresponsal bancario"]);
  const before = f.rows("expenseEvent").length;
  await f.service.reclassifyExpense(A, other.id, { ...keys(), expectedVersion: 2, description: other.description });
  assert.equal(f.rows("expenseEvent").length, before, "a no-op reclassification writes no event");
});

test("void and replace: atomic, reason required, terminal VOIDED, injected failure rolls back everything", async () => {
  const f = fixture(); const cats = await seed(f); const rent = categoryId(cats, "Arriendo");
  const e = await create(f, A, rent);
  const counts = f.counts();
  f.fail("expenseEvent:REPLACED");
  await assert.rejects(f.service.voidExpense(A, e.id, { ...keys(), expectedVersion: 1, reason: "Monto equivocado", replacement: { expenseDate: "2026-11-20", amount: "160000", categoryId: rent, paymentMethod: "CASH", description: "Arriendo local" } }), /fixture-write-failure/);
  assert.deepEqual(f.counts(), counts, "nothing persisted"); assert.equal(f.rows("expense").find(x => x.id === e.id)!.status, "CONFIRMED");
  f.fail("");
  const archived = cats.find(c => c.seedKey === "other")!; await f.service.archiveCategory(A, archived.id, { ...keys(), expectedVersion: archived.version });
  await assert.rejects(f.service.voidExpense(A, e.id, { ...keys(), expectedVersion: 1, reason: "Monto equivocado", replacement: { expenseDate: "2026-11-20", amount: "160000", categoryId: archived.id, paymentMethod: "CASH", description: "x" } }), /EXPENSE_CATEGORY_ARCHIVED/);
  assert.equal(f.rows("expense").find(x => x.id === e.id)!.status, "CONFIRMED", "replacement failure keeps the original");
  const done = await f.service.voidExpense(A, e.id, { ...keys(), expectedVersion: 1, reason: "Monto equivocado", replacement: { expenseDate: "2026-11-20", amount: "160000", categoryId: rent, paymentMethod: "CASH", description: "Arriendo local" } }) as any;
  assert.equal(done.voided.status, "VOIDED"); assert.equal(done.replacement.replacesExpenseId, e.id); assert.equal(done.voided.replacedByExpenseId, done.replacement.id);
  await assert.rejects(f.service.voidExpense(A, e.id, { ...keys(), expectedVersion: 2, reason: "Otra vez" }), /INVALID_EXPENSE_TRANSITION/);
  await assert.rejects(f.service.reclassifyExpense(A, e.id, { ...keys(), expectedVersion: 2, description: "x" }), /INVALID_EXPENSE_TRANSITION/);
  assert.deepEqual(f.rows("expenseEvent").filter(x => x.entityId === e.id).map(x => x.eventType), ["CREATED", "VOIDED", "REPLACED"]);
});

test("idempotency like Ventas v2.1: new requestId replays, other content conflicts, reused requestId conflicts, failed attempt leaves no receipt", async () => {
  const f = fixture(); const cats = await seed(f); const rent = categoryId(cats, "Arriendo");
  const body = expenseBody(rent);
  const first = await f.service.createExpense(A, body) as any;
  const again = await f.service.createExpense(A, { ...body, requestId: randomUUID() }) as any;
  assert.equal(again.idempotent, true); assert.equal(again.expense.id, first.expense.id); assert.equal(f.rows("expense").length, 1);
  await assert.rejects(f.service.createExpense(A, { ...body, requestId: randomUUID(), amount: "1" }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.service.createExpense(A, { ...expenseBody(rent), requestId: body.requestId }), (e: any) => e.code === "P2002" && String(e.meta.target).includes("requestId"));
  const [x, y] = await Promise.all([f.service.createExpense(A, body), f.service.createExpense(A, body)]) as any[];
  assert.equal(x.expense.id, y.expense.id);
  f.fail("expenseEvent"); const k = expenseBody(rent, { amount: "2" });
  await assert.rejects(f.service.createExpense(A, k), /fixture-write-failure/); f.fail("");
  assert.equal((await f.service.createExpense(A, { ...k, requestId: randomUUID() }) as any).idempotent, false, "the same key can be retried after a rollback");
});

test("list, cursor, summary and detail: confirmed only by default, totals exclude voided, reference only in detail", async () => {
  const f = fixture(); const cats = await seed(f); const rent = categoryId(cats, "Arriendo"), util = categoryId(cats, "Servicios públicos");
  for (let i = 0; i < 27; i++) await create(f, A, i % 2 ? rent : util, { amount: String(1000 + i), expenseDate: `2026-11-${String(1 + (i % 20)).padStart(2, "0")}`, paymentMethod: i % 3 ? "CASH" : "NEQUI", paymentReference: "SECRET-REF" });
  const voided = await create(f, A, rent, { amount: "999999" });
  await f.service.voidExpense(A, voided.id, { ...keys(), expectedVersion: 1, reason: "Duplicado" });
  const page1 = await f.service.listExpenses(A, { from: "2026-11-01", to: "2026-11-30" }) as any;
  assert.equal(page1.items.length, 25); assert.ok(page1.nextCursor);
  assert.ok(page1.items.every((i: Row) => !("paymentReference" in i)), "the list never exposes paymentReference");
  const page2 = await f.service.listExpenses(A, { from: "2026-11-01", to: "2026-11-30", cursor: page1.nextCursor }) as any;
  assert.equal(page2.items.length, 2); assert.equal(page2.nextCursor, null);
  assert.equal(new Set([...page1.items, ...page2.items].map((i: Row) => i.id)).size, 27);
  assert.equal((await f.service.listExpenses(A, { from: "2026-11-01", to: "2026-11-30", status: "VOIDED" }) as any).items.length, 1);
  const s = await f.service.summary(A, { from: "2026-11-01", to: "2026-11-30" }) as any;
  const expected = Array.from({ length: 27 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0);
  assert.equal(s.confirmedTotal, String(expected)); assert.equal(s.confirmedCount, 27); assert.equal(s.voidedCount, 1); assert.equal(s.pendingCount, 0);
  assert.equal(s.byCategory.reduce((a: bigint, c: Row) => a + BigInt(c.total), 0n), BigInt(expected));
  assert.equal(s.byPaymentMethod.reduce((a: bigint, c: Row) => a + BigInt(c.total), 0n), BigInt(expected));
  const filtered = await f.service.summary(A, { from: "2026-11-01", to: "2026-11-30", categoryId: rent, paymentMethod: "CASH" }) as any;
  assert.ok(BigInt(filtered.confirmedTotal) < BigInt(expected));
  const detail = await f.service.detail(A, voided.id) as any;
  assert.equal(detail.expense.paymentReference, null); assert.deepEqual(detail.events.map((e: Row) => e.eventType), ["CREATED", "VOIDED"]);
  await assert.rejects(f.service.listExpenses(A, { from: "2026-11-01", to: "2026-11-30", cursor: "bad-cursor" }), /INVALID_EXPENSE_INPUT/);
});

test("two accounts: every F1a endpoint with the other account's ids is 404 without writes; keys, seeds and totals are independent", async () => {
  const f = fixture(); const catsA = await seed(f, A); const catsB = await seed(f, B);
  const eA = await create(f, A, categoryId(catsA, "Arriendo")); const eB = await create(f, B, categoryId(catsB, "Arriendo"), { amount: "777" });
  const catB = catsB[0], catA = categoryId(catsA, "Arriendo");
  const before = f.counts();
  const attempts: [string, () => Promise<unknown>, RegExp][] = [
    ["update other category", () => f.service.updateCategory(A, catB.id, { ...keys(), expectedVersion: 1, name: "Robada" }), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["archive other category", () => f.service.archiveCategory(A, catB.id, { ...keys(), expectedVersion: 1 }), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["reactivate other category", () => f.service.reactivateCategory(A, catB.id, { ...keys(), expectedVersion: 1 }), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["create with other category", () => f.service.createExpense(A, expenseBody(catB.id)), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["detail of other expense", () => f.service.detail(A, eB.id), /EXPENSE_NOT_FOUND/],
    ["reclassify other expense", () => f.service.reclassifyExpense(A, eB.id, { ...keys(), expectedVersion: 1, description: "x" }), /EXPENSE_NOT_FOUND/],
    ["reclassify own expense to other category", () => f.service.reclassifyExpense(A, eA.id, { ...keys(), expectedVersion: 1, categoryId: catB.id }), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["void other expense", () => f.service.voidExpense(A, eB.id, { ...keys(), expectedVersion: 1, reason: "Ajeno" }), /EXPENSE_NOT_FOUND/],
    ["replace with other category", () => f.service.voidExpense(A, eA.id, { ...keys(), expectedVersion: 1, reason: "Cambio", replacement: { expenseDate: "2026-11-20", amount: "1", categoryId: catB.id, paymentMethod: "CASH", description: "x" } }), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["list filtered by other category", () => f.service.listExpenses(A, { from: "2026-11-01", to: "2026-11-30", categoryId: catB.id }), /EXPENSE_CATEGORY_NOT_FOUND/],
    ["summary filtered by other category", () => f.service.summary(A, { from: "2026-11-01", to: "2026-11-30", categoryId: catB.id }), /EXPENSE_CATEGORY_NOT_FOUND/],
  ];
  for (const [name, attempt, expected] of attempts) await assert.rejects(attempt(), expected, name);
  assert.deepEqual(f.counts(), before, "no cross-account attempt wrote anything");
  assert.equal(f.rows("expense").find(x => x.id === eA.id)!.status, "CONFIRMED");
  const shared = keys();
  const a = await f.service.createExpense(A, { ...expenseBody(catA), ...shared }) as any;
  const b = await f.service.createExpense(B, { ...expenseBody(categoryId(catsB, "Arriendo")), ...shared }) as any;
  assert.notEqual(a.expense.id, b.expense.id); assert.equal(b.idempotent, false, "the same operationId and requestId in another account is independent");
  assert.equal(((await f.service.listCategories(A, { status: "all" })) as any).categories.length, SEED_CATEGORIES.length);
  assert.equal(((await f.service.listCategories(B, { status: "all" })) as any).categories.length, SEED_CATEGORIES.length);
  const listA = (await f.service.listExpenses(A, { from: "2026-11-01", to: "2026-11-30" }) as any).items;
  assert.ok(listA.every((i: Row) => i.id !== eB.id && i.id !== b.expense.id));
  assert.equal((await f.service.summary(B, { from: "2026-11-01", to: "2026-11-30" }) as any).confirmedTotal, String(777 + 150000));
});

test("closed account: every mutation fails with ACCOUNT_CLOSED and writes nothing", async () => {
  const f = fixture(); const cats = await seed(f); const e = await create(f, A, categoryId(cats, "Arriendo"));
  f.close(A); const before = f.counts();
  for (const attempt of [() => f.service.createExpense(A, expenseBody(cats[0].id)), () => f.service.voidExpense(A, e.id, { ...keys(), expectedVersion: 1, reason: "Cerrada" }),
    () => f.service.seedCategories(A, keys()), () => f.service.createCategory(A, { ...keys(), name: "Nueva" })]) await assert.rejects(attempt(), /ACCOUNT_CLOSED/);
  assert.deepEqual(f.counts(), before);
});

test("HTTP: real authentication, 16 KiB limit, private no-store, 201 then replay 200, conflict details, safe 503, no reference in lists", async () => {
  process.env.JWT_SECRET = "expenses-tests-only-secret-at-least-32-bytes-long";
  const { makeExpenseRouter } = await import("../routes/expense.routes.js");
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const f = fixture(); const cats = await seed(f);
  const user: User = { id: A, email: "fixture@example.invalid", passwordHash: null, googleId: null, emailVerifiedAt: null, sessionVersion: 0, closedAt: null, role: "USER", name: null, createdAt: NOW, updatedAt: NOW };
  const app = express(); app.use("/api", makeExpenseRouter(makeExpenseController(f.service), makeAuthenticate(async id => id === A ? user : null)));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const token = generateToken({ userId: A, email: user.email });
  const call = (path: string, method = "GET", body?: unknown, auth = true) => fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await call("/expense-categories", "GET", undefined, false)).status, 401);
    const list = await call("/expense-categories"); assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "private, no-store");
    assert.equal((await call("/expenses", "POST", { ...expenseBody(cats[0].id), description: "x".repeat(17000) })).status, 413);
    assert.equal((await call("/expenses", "POST", { ...expenseBody(cats[0].id), ownerId: B })).status, 400);
    assert.equal((await call("/expenses?from=2026-11-01&to=2026-11-30&from=2026-10-01")).status, 400, "repeated query parameter");
    const body = expenseBody(cats[0].id, { paymentReference: "PRIVATE-REF" });
    assert.equal((await call("/expenses", "POST", body)).status, 201);
    const replay = await call("/expenses", "POST", { ...body, requestId: randomUUID() }); assert.equal(replay.status, 200); assert.equal((await replay.json()).result.idempotent, true);
    const listed = await (await call("/expenses?from=2026-11-01&to=2026-11-30")).text();
    assert.doesNotMatch(listed, /PRIVATE-REF/, "lists never carry the reference");
    const conflict = await call("/expense-categories", "POST", { ...keys(), name: "arriendo" });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).details.existingId, cats.find(c => c.seedKey === "rent")!.id);
    assert.equal((await call(`/expenses/${randomUUID()}`)).status, 404);
    f.fail("expenseEvent"); const failure = await call("/expenses", "POST", expenseBody(cats[0].id, { description: "Texto privado del gasto" }));
    assert.equal(failure.status, 503); const text = await failure.text(); assert.doesNotMatch(text, /fixture-write-failure|Texto privado/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
