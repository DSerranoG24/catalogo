import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { makeSaleService } from "./sale.service";

// In-memory double with per-transaction undo logs and blocking row locks. It models
// FOR UPDATE waits, stock >= 0 and the sale_return_line_guard trigger; it is not a
// PostgreSQL certification (see src/scripts/verify-sale-integrity-postgres.ts).
const owner = randomUUID(), other = randomUUID();
const tick = () => new Promise(resolve => setImmediate(resolve));
type Row = Record<string, any>;

function fixture() {
  const state = { sales: [] as Row[], lines: [] as Row[], items: [] as Row[], operations: [] as Row[], movements: [] as Row[], returns: [] as Row[], returnLines: [] as Row[], entries: [] as Row[] };
  const holders = new Map<string, number>(), waiters = new Map<string, (() => void)[]>();
  const events: string[] = [];
  let nextTx = 0;
  async function acquire(key: string, tx: number) {
    while (holders.has(key) && holders.get(key) !== tx) await new Promise<void>(resolve => waiters.set(key, [...(waiters.get(key) ?? []), resolve]));
    holders.set(key, tx); events.push(`${tx}:${key}`);
  }
  function releaseAll(tx: number) {
    for (const [key, holder] of [...holders]) if (holder === tx) { holders.delete(key); const queue = waiters.get(key) ?? []; waiters.delete(key); queue.forEach(resolve => resolve()); }
  }
  function client(tx: number, undo: (() => void)[]) {
    const push = <T extends Row>(list: T[], row: T) => { list.push(row); undo.push(() => list.splice(list.indexOf(row), 1)); return row; };
    const patch = (row: Row, values: Row) => { const before = { ...row }; Object.assign(row, values); undo.push(() => { for (const key of Object.keys(row)) delete row[key]; Object.assign(row, before); }); };
    const view = (sale: Row) => ({ ...structuredClone(sale), lines: structuredClone(state.lines.filter(line => line.saleId === sale.id)), customer: null });
    const result = (sale: Row) => ({ ...view(sale), returns: structuredClone(state.returns.filter(r => r.saleId === sale.id).map(r => ({ ...r, lines: state.returnLines.filter(l => l.returnId === r.id) }))) });
    return {
      // Account money lock: a real per-owner lock in this double, taken before users (Agents.md).
      async $executeRaw(first: any, ...rest: unknown[]) {
        const sql: string = Array.isArray(first) ? first.join("?") : first.sql; const values: unknown[] = Array.isArray(first) ? rest : first.values;
        assert.match(sql, /pg_advisory_xact_lock\(hashtext\('account-money-v1'\)/); await acquire(`money:${values[0]}`, tx); return 1;
      },
      async $queryRaw(first: any, ...rest: unknown[]) {
        const sql: string = Array.isArray(first) ? first.join("?") : first.sql; const values: unknown[] = Array.isArray(first) ? rest : first.values;
        if (sql.includes("FROM users")) { assert.match(sql, /FOR SHARE/); return [{ id: values[0] }]; }
        if (sql.includes('FROM "Sale"')) { assert.match(sql, /FOR UPDATE/); await acquire(`sale:${values[0]}`, tx); return []; }
        if (sql.includes("FROM inventory_items")) {
          assert.match(sql, /ORDER BY id FOR UPDATE/); const [user, ...ids] = values as string[]; assert.equal(user, values[0]);
          events.push(`${tx}:items:${ids.join(",")}`);
          for (const id of [...ids].sort()) await acquire(`item:${id}`, tx);
          return ids.map(id => ({ id }));
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      sale: {
        async findFirst({ where, include }: any) { assert.ok(where.userId); await tick(); const sale = state.sales.find(s => s.id === where.id && s.userId === where.userId); return sale ? (include?.returns ? result(sale) : view(sale)) : null; },
        async findUniqueOrThrow({ where }: any) { const sale = state.sales.find(s => s.id === where.id); if (!sale) throw new Error("NotFound"); return result(sale); },
        async update({ where, data, include }: any) {
          const sale = state.sales.find(s => s.id === where.id); assert.ok(sale); const { version, ...rest } = data;
          // Mirrors sale_status_transition_guard.
          const allowed: Row = { DRAFT: ["CONFIRMED", "DELIVERED"], CONFIRMED: ["DELIVERED", "CANCELLED"], DELIVERED: ["RETURNED"] };
          if (rest.status && rest.status !== sale.status && !(allowed[sale.status] ?? []).includes(rest.status)) throw new Error("INVALID_SALE_TRANSITION");
          patch(sale, { ...rest, version: sale.version + (version?.increment ?? 0) });
          assert.ok(include?.lines && include?.returns, "mutation responses must include lines and returns");
          return result(sale);
        },
      },
      saleOperation: {
        async findFirst({ where }: any) { assert.ok(where.userId); assert.equal(where.OR, undefined, "receipts are looked up by operationId only"); await tick(); return structuredClone(state.operations.find(op => op.userId === where.userId && op.id === where.id) ?? null); },
        async create({ data }: any) { if (state.operations.some(op => op.id === data.id || (op.userId === data.userId && op.requestId === data.requestId))) throw Object.assign(new Error("P2002"), { code: "P2002" }); return structuredClone(push(state.operations, { ...data, responseSnapshot: null })); },
        async update({ where, data }: any) { const op = state.operations.find(o => o.id === where.id); assert.ok(op); assert.doesNotThrow(() => JSON.stringify(data.responseSnapshot), "receipts are stored as plain JSON: BigInt amounts as decimal strings, the format replayed to clients"); patch(op, data); return structuredClone(op); },
      },
      inventoryItem: {
        async findFirst({ where }: any) { assert.equal(where.userId, owner); await tick(); return structuredClone(state.items.find(item => item.id === where.id && item.userId === where.userId) ?? null); },
        async findFirstOrThrow(args: any) { const row = await this.findFirst(args); if (!row) throw new Error("NotFound"); return row; },
        async findMany({ where, include }: any) { assert.equal(where.userId, owner); await tick(); return structuredClone(state.items.filter(item => item.userId === where.userId && where.id.in.includes(item.id)).map(item => include?.commercialTerms ? item : { ...item, commercialTerms: undefined })); },
        async update({ where, data }: any) {
          const item = state.items.find(i => i.id === where.id); assert.ok(item); assert.equal(holders.get(`item:${item.id}`), tx, "stock written without holding the item lock");
          const stock = item.stock + (data.stock.increment ?? 0) - (data.stock.decrement ?? 0);
          if (stock < 0) throw new Error("inventory_items_stock_check");
          patch(item, { stock, stockVersion: item.stockVersion + 1 }); return structuredClone(item);
        },
      },
      inventoryMovement: { async create({ data }: any) { assert.equal(data.resultingStock, data.previousStock + data.delta); return push(state.movements, { ...data, at: state.movements.length }); } },
      saleReturn: { async create({ data }: any) { return push(state.returns, { id: randomUUID(), ...data }); } },
      // Payments book (F2a-3c: every confirmation is TRACKED). No customers here, so no credit entries.
      salePaymentEntry: {
        async findMany({ where }: any) { await tick(); return structuredClone(state.entries.filter(e => e.ownerId === where.ownerId && (where.saleId?.in ? where.saleId.in.includes(e.saleId) : e.saleId === where.saleId))); },
        async create({ data }: any) { return structuredClone(push(state.entries, { id: randomUUID(), createdAt: new Date(), reversesEntryId: null, creditEntryId: null, ...data })); },
      },
      saleReturnLine: {
        async findMany({ where }: any) { await tick(); return structuredClone(state.returnLines.filter(l => where.saleLineId.in.includes(l.saleLineId))); },
        async create({ data }: any) {
          // Mirrors sale_return_line_guard: cumulative returns never exceed the sold quantity.
          const line = state.lines.find(l => l.id === data.saleLineId); const ret = state.returns.find(r => r.id === data.returnId);
          if (!line || !ret || line.saleId !== ret.saleId) throw new Error("SALE_RETURN_LINE_SALE_MISMATCH");
          const already = state.returnLines.filter(l => l.saleLineId === data.saleLineId).reduce((sum, l) => sum + l.receivedQuantity, 0);
          if (already + data.receivedQuantity > line.quantity) throw new Error("SALE_RETURN_EXCEEDS_SOLD");
          return push(state.returnLines, { id: randomUUID(), ...data });
        },
      },
    };
  }
  const database: any = {
    async $transaction(work: (tx: any) => Promise<unknown>) {
      const tx = ++nextTx, undo: (() => void)[] = [];
      try { return await work(client(tx, undo)); }
      catch (error) { for (const step of undo.reverse()) step(); throw error; }
      finally { releaseAll(tx); }
    },
  };
  function item(stock: number, id = randomUUID()) {
    state.items.push({ id, userId: owner, name: `Item ${id.slice(0, 4)}`, sku: id.slice(0, 8), stock, stockVersion: 1, commercialTerms: { version: 1, unitSalePrice: 100n, referenceUnitCost: null } });
    return id;
  }
  function draft(lines: { itemId: string; quantity: number }[], userId = owner) {
    const id = randomUUID();
    state.sales.push({ id, userId, status: "DRAFT", version: 2, currency: "COP", subtotal: 0n, discountTotal: 0n, total: 0n, confirmedAt: null, deliveredAt: null, cancelledAt: null, returnedAt: null });
    for (const line of lines) state.lines.push({ id: randomUUID(), saleId: id, inventoryItemId: line.itemId, quantity: line.quantity, itemName: "x", sku: "x", unitPrice: 100n, unitDiscount: 0n, lineTotal: 100n * BigInt(line.quantity), unitCost: null, commercialTermsVersion: 1 });
    const total = 100n * BigInt(lines.reduce((sum, line) => sum + line.quantity, 0));
    Object.assign(state.sales.at(-1)!, { subtotal: total, total });
    return id;
  }
  /** Delivering a confirmed sale pays what is left of it (fiado is off): the total of the sale in cash. */
  const pay = (saleId: string) => ({ payments: [{ method: "CASH" as const, amount: String(state.sales.find(s => s.id === saleId)!.total) }] });
  return { state, events, service: makeSaleService(database), item, draft, pay };
}
// F2a-3c: every confirmation sends its payments; an advance of 0 is payments: [].
const confirmInput = (version = 2) => ({ operationId: randomUUID(), requestId: randomUUID(), expectedVersion: version, deliverImmediately: false, payments: [] as { method: "CASH"; amount: string }[] });
/** Confirm and deliver at once: paid in full in cash (fiado is off). Lines cost 100 each in this double. */
const paidNow = (units: number) => ({ ...confirmInput(), deliverImmediately: true, payments: [{ method: "CASH" as const, amount: String(100 * units) }] });
const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });

test("two concurrent confirmations on the same item serialize on the item lock: ledger stays chained", { timeout: 5000 }, async () => {
  const f = fixture(); const itemId = f.item(3);
  const a = f.draft([{ itemId, quantity: 1 }]), b = f.draft([{ itemId, quantity: 1 }]);
  await Promise.all([f.service.confirm(owner, a, confirmInput()), f.service.confirm(owner, b, confirmInput())]);
  assert.equal(f.state.items[0].stock, 1);
  // Without the lock both transactions read stock 3 and both movements would say 3 -> 2.
  assert.deepEqual(f.state.movements.map(m => [m.previousStock, m.resultingStock]), [[3, 2], [2, 1]]);
});

test("two concurrent confirmations for the last unit: exactly one succeeds, the other rolls back fully", { timeout: 5000 }, async () => {
  const f = fixture(); const itemId = f.item(1);
  const a = f.draft([{ itemId, quantity: 1 }]), b = f.draft([{ itemId, quantity: 1 }]);
  const results = await Promise.allSettled([f.service.confirm(owner, a, confirmInput()), f.service.confirm(owner, b, confirmInput())]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.match(String(rejected.reason?.message), /STOCK_INSUFFICIENT/);
  assert.equal(f.state.items[0].stock, 0); assert.equal(f.state.movements.length, 1);
  assert.equal(f.state.operations.length, 1, "the losing operation must not stay PREPARED");
  assert.deepEqual(f.state.sales.map(s => s.status).sort(), ["CONFIRMED", "DRAFT"]);
});

test("the same sale confirmed concurrently with two different keys discounts stock only once", { timeout: 5000 }, async () => {
  const f = fixture(); const itemId = f.item(5); const sale = f.draft([{ itemId, quantity: 2 }]);
  const results = await Promise.allSettled([f.service.confirm(owner, sale, confirmInput()), f.service.confirm(owner, sale, confirmInput())]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(String((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason?.message), /VERSION_CONFLICT/);
  assert.equal(f.state.items[0].stock, 3); assert.equal(f.state.movements.length, 1);
});

test("items are locked in id order after the sale; crossed multi-item sales do not deadlock", { timeout: 5000 }, async () => {
  const f = fixture(); const [low, high] = [randomUUID(), randomUUID()].sort();
  f.item(4, high); f.item(4, low);
  const a = f.draft([{ itemId: high, quantity: 1 }, { itemId: low, quantity: 1 }]);
  const b = f.draft([{ itemId: low, quantity: 1 }, { itemId: high, quantity: 1 }]);
  await Promise.all([f.service.confirm(owner, a, confirmInput()), f.service.confirm(owner, b, confirmInput())]);
  assert.ok(f.state.items.every(item => item.stock === 2));
  for (const tx of new Set(f.events.map(event => event.split(":")[0]))) {
    const mine = f.events.filter(event => event.startsWith(`${tx}:`)).map(event => event.slice(tx.length + 1));
    const request = mine.find(event => event.startsWith("items:"));
    assert.ok(request, "confirmation must lock its items explicitly");
    assert.deepEqual(request.slice(6).split(","), [low, high], "item ids must be requested in ascending order");
    assert.ok(mine.findIndex(e => e.startsWith("sale:")) < mine.indexOf(request), "Sale lock precedes item locks");
  }
});

test("cancel and return also lock items before writing and keep the ledger chained", { timeout: 5000 }, async () => {
  const f = fixture(); const itemId = f.item(10);
  const a = f.draft([{ itemId, quantity: 2 }]), b = f.draft([{ itemId, quantity: 3 }]);
  const ca = await f.service.confirm(owner, a, paidNow(2));
  const cb = await f.service.confirm(owner, b, confirmInput());
  const lineA = f.state.lines.find(l => l.saleId === a)!;
  await Promise.all([
    f.service.cancel(owner, b, { ...keys(), expectedVersion: cb.version, reason: "Cliente desistió" }),
    f.service.returnSale(owner, a, { ...keys(), expectedVersion: ca.version, reason: "Devolución total", lines: [{ saleLineId: lineA.id, receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 1 }] }),
  ]);
  assert.equal(f.state.items[0].stock, 10 - 2 - 3 + 3 + 1);
  const chain = f.state.movements.sort((x, y) => x.at - y.at);
  for (let i = 1; i < chain.length; i++) assert.equal(chain[i].previousStock, chain[i - 1].resultingStock, "every movement starts from the previous balance");
  assert.ok(f.events.filter(e => e.includes(":items:")).length >= 4);
});

test("a retried confirm with a key that already succeeded returns the stored receipt before the version check", async () => {
  const f = fixture(); const itemId = f.item(5); const sale = f.draft([{ itemId, quantity: 2 }]);
  const input = confirmInput(); const first = await f.service.confirm(owner, sale, input);
  assert.equal(first.status, "CONFIRMED");
  const retry: any = await f.service.confirm(owner, sale, input);
  assert.equal(retry.id, sale); assert.equal(retry.status, "CONFIRMED"); assert.equal(retry.version, first.version);
  assert.equal(retry.total, "200", "the stored receipt is JSON-safe: BigInt saved as a decimal string");
  assert.equal(f.state.movements.length, 1); assert.equal(f.state.items[0].stock, 3); assert.equal(f.state.operations.length, 1);
  // Even after the sale moved on, the original key still replays the original receipt.
  await f.service.transition(owner, sale, { ...keys(), expectedVersion: first.version, ...f.pay(sale) });
  const later: any = await f.service.confirm(owner, sale, input);
  assert.equal(later.status, "CONFIRMED"); assert.equal(f.state.sales[0].status, "DELIVERED"); assert.equal(f.state.movements.length, 1);
  // Same key with another payload, another sale or another account never replays.
  await assert.rejects(f.service.confirm(owner, sale, { ...input, deliverImmediately: true }), /IDEMPOTENCY_CONFLICT/);
  const otherSale = f.draft([{ itemId, quantity: 1 }]);
  await assert.rejects(f.service.confirm(owner, otherSale, input), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.service.confirm(other, sale, input), /NOT_FOUND/);
});

test("deliver, cancel and return retries replay their receipts without repeating stock effects", async () => {
  const f = fixture(); const itemId = f.item(6);
  const a = f.draft([{ itemId, quantity: 2 }]), b = f.draft([{ itemId, quantity: 1 }]);
  const ca = await f.service.confirm(owner, a, confirmInput()), cb = await f.service.confirm(owner, b, confirmInput());
  const deliver = { ...keys(), expectedVersion: ca.version, ...f.pay(a) };
  const delivered = await f.service.transition(owner, a, deliver);
  assert.equal((await f.service.transition(owner, a, deliver) as any).version, delivered.version);
  const cancel = { ...keys(), expectedVersion: cb.version, reason: "Error de captura" };
  await f.service.cancel(owner, b, cancel); await f.service.cancel(owner, b, cancel);
  const line = f.state.lines.find(l => l.saleId === a)!;
  const ret = { ...keys(), expectedVersion: delivered.version, reason: "Devolución total", lines: [{ saleLineId: line.id, receivedQuantity: 2, resellableQuantity: 2, damagedQuantity: 0 }] };
  await f.service.returnSale(owner, a, ret); const replay: any = await f.service.returnSale(owner, a, ret);
  assert.equal(replay.status, "RETURNED");
  assert.equal(f.state.items[0].stock, 6); assert.equal(f.state.returns.length, 1); assert.equal(f.state.returnLines.length, 1);
  assert.equal(f.state.movements.length, 4, "two confirmations, one cancellation, one return");
  await assert.rejects(f.service.cancel(owner, b, { ...cancel, reason: "Otro motivo" }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.service.transition(owner, b, { ...cancel, reason: undefined } as any), /IDEMPOTENCY_CONFLICT/);
});

test("a fresh key on a stale version still fails, and a failed attempt leaves no receipt", async () => {
  const f = fixture(); const itemId = f.item(1); const sale = f.draft([{ itemId, quantity: 2 }]);
  const input = confirmInput();
  await assert.rejects(f.service.confirm(owner, sale, input), /STOCK_INSUFFICIENT/);
  assert.equal(f.state.operations.length, 0); assert.equal(f.state.items[0].stock, 1);
  await assert.rejects(f.service.confirm(owner, sale, confirmInput(1)), /VERSION_CONFLICT/);
  f.state.items[0].stock = 2;
  assert.equal((await f.service.confirm(owner, sale, input)).status, "CONFIRMED", "the same key may be retried after a rolled-back failure");
});

// ---- Sales rules fixed after the 2026-11-24 production test ----

async function delivered(f: ReturnType<typeof fixture>, lines: { itemId: string; quantity: number }[]) {
  const id = f.draft(lines); const sale: any = await f.service.confirm(owner, id, paidNow(lines.reduce((sum, line) => sum + line.quantity, 0)));
  return { id, sale, lines: f.state.lines.filter(l => l.saleId === id) };
}

test("a DELIVERED sale cannot be cancelled (409 INVALID_TRANSITION); only CONFIRMED sales are", async () => {
  const f = fixture(); const itemId = f.item(5);
  const { id, sale } = await delivered(f, [{ itemId, quantity: 2 }]);
  await assert.rejects(f.service.cancel(owner, id, { ...keys(), expectedVersion: sale.version, reason: "Intento tras entrega" }), /INVALID_TRANSITION/);
  assert.equal(f.state.sales.find(s => s.id === id)!.status, "DELIVERED"); assert.equal(f.state.items[0].stock, 3);
  assert.equal(f.state.movements.length, 1, "no compensation movement was written");
  const confirmed = f.draft([{ itemId, quantity: 1 }]); const c: any = await f.service.confirm(owner, confirmed, confirmInput());
  assert.equal(((await f.service.cancel(owner, confirmed, { ...keys(), expectedVersion: c.version, reason: "Cliente desistió" })) as any).status, "CANCELLED");
});

test("same operationId + same content + new requestId replays the receipt; other content conflicts (every operation)", async () => {
  const f = fixture(); const itemId = f.item(10);
  const sale = f.draft([{ itemId, quantity: 2 }]);
  const confirm = confirmInput(); const first: any = await f.service.confirm(owner, sale, confirm);
  const again: any = await f.service.confirm(owner, sale, { ...confirm, requestId: randomUUID() });
  assert.equal(again.version, first.version); assert.equal(f.state.movements.length, 1); assert.equal(f.state.operations.length, 2 - 1);
  await assert.rejects(f.service.confirm(owner, sale, { ...confirm, requestId: randomUUID(), deliverImmediately: true }), /IDEMPOTENCY_CONFLICT/);
  const deliver = { ...keys(), expectedVersion: first.version, ...f.pay(sale) }; const d: any = await f.service.transition(owner, sale, deliver);
  assert.equal(((await f.service.transition(owner, sale, { ...deliver, requestId: randomUUID() })) as any).version, d.version);
  const line = f.state.lines.find(l => l.saleId === sale)!;
  const ret = { ...keys(), expectedVersion: d.version, reason: "Devolución parcial", lines: [{ saleLineId: line.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] };
  await f.service.returnSale(owner, sale, ret); await f.service.returnSale(owner, sale, { ...ret, requestId: randomUUID() });
  assert.equal(f.state.returns.length, 1); assert.equal(f.state.items[0].stock, 9);
  await assert.rejects(f.service.returnSale(owner, sale, { ...ret, requestId: randomUUID(), reason: "Otro motivo" }), /IDEMPOTENCY_CONFLICT/);
  const other = f.draft([{ itemId, quantity: 1 }]); const oc: any = await f.service.confirm(owner, other, confirmInput());
  const cancel = { ...keys(), expectedVersion: oc.version, reason: "Error de captura" };
  await f.service.cancel(owner, other, cancel); await f.service.cancel(owner, other, { ...cancel, requestId: randomUUID() });
  assert.equal(f.state.movements.filter(m => m.saleMovementRole === "SALE_CANCELLATION").length, 1);
});

test("partial returns in several steps: DELIVERED until everything is returned, then RETURNED", async () => {
  const f = fixture(); const a = f.item(10), b = f.item(10);
  const { id, sale, lines } = await delivered(f, [{ itemId: a, quantity: 3 }, { itemId: b, quantity: 1 }]);
  const la = lines.find(l => l.inventoryItemId === a)!, lb = lines.find(l => l.inventoryItemId === b)!;
  const first: any = await f.service.returnSale(owner, id, { ...keys(), expectedVersion: sale.version, reason: "Primera devolución", lines: [{ saleLineId: la.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] });
  assert.equal(first.status, "DELIVERED"); assert.equal(first.returnedAt, null); assert.equal(first.returns.length, 1);
  assert.equal(first.lines.length, 2, "the response includes the sale lines");
  const second: any = await f.service.returnSale(owner, id, { ...keys(), expectedVersion: first.version, reason: "Segunda devolución", lines: [
    { saleLineId: la.id, receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 1 },
    { saleLineId: lb.id, receivedQuantity: 1, resellableQuantity: 0, damagedQuantity: 1 },
  ] });
  assert.equal(second.status, "RETURNED"); assert.ok(second.returnedAt); assert.equal(second.returns.length, 2);
  assert.deepEqual(second.returns.map((r: Row) => r.reason), ["Primera devolución", "Segunda devolución"]);
  const reloaded: any = await f.service.get(owner, id);
  assert.equal(reloaded.returns.length, 2, "GET /sales/:id includes every return after a reload");
  assert.deepEqual(reloaded.returns.flatMap((r: Row) => r.lines.map((l: Row) => l.receivedQuantity)).sort(), [1, 1, 2]);
  assert.equal(f.state.items.find(i => i.id === a)!.stock, 7 + 1 + 1); assert.equal(f.state.items.find(i => i.id === b)!.stock, 9);
  const keysOfReturns = new Set(f.state.movements.filter(m => m.saleMovementRole === "SALE_RETURN_RESELLABLE").map(m => m.key));
  assert.equal(keysOfReturns.size, 2, "each return writes its own movements under its own operation");
  await assert.rejects(f.service.returnSale(owner, id, { ...keys(), expectedVersion: second.version, reason: "Tercera", lines: [{ saleLineId: la.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] }), /INVALID_TRANSITION/);
});

test("a return can never exceed what was sold, per line and cumulatively; failures write nothing", async () => {
  const f = fixture(); const a = f.item(10);
  const { id, sale, lines: [line] } = await delivered(f, [{ itemId: a, quantity: 2 }]);
  const one = (q: number) => ({ saleLineId: line.id, receivedQuantity: q, resellableQuantity: q, damagedQuantity: 0 });
  await assert.rejects(f.service.returnSale(owner, id, { ...keys(), expectedVersion: sale.version, reason: "De más", lines: [one(3)] }), /RETURN_EXCEEDS_SOLD/);
  const first: any = await f.service.returnSale(owner, id, { ...keys(), expectedVersion: sale.version, reason: "Una", lines: [one(1)] });
  await assert.rejects(f.service.returnSale(owner, id, { ...keys(), expectedVersion: first.version, reason: "De más acumulado", lines: [one(2)] }), /RETURN_EXCEEDS_SOLD/);
  await assert.rejects(f.service.returnSale(owner, id, { ...keys(), expectedVersion: first.version, reason: "Duplicada", lines: [one(1), one(1)] }), /RETURN_LINE_DUPLICATE/);
  await assert.rejects(f.service.returnSale(owner, id, { ...keys(), expectedVersion: first.version, reason: "Ajena", lines: [{ ...one(1), saleLineId: randomUUID() }] }), /RETURN_LINE_NOT_FOUND/);
  assert.equal(f.state.returns.length, 1); assert.equal(f.state.returnLines.length, 1); assert.equal(f.state.items[0].stock, 9);
  assert.equal(f.state.operations.filter(op => op.type === "RETURN").length, 1, "rejected returns leave no receipt");
});

test("two concurrent returns of the remaining units: the sale lock lets only one through", { timeout: 5000 }, async () => {
  const f = fixture(); const a = f.item(10);
  const { id, sale, lines: [line] } = await delivered(f, [{ itemId: a, quantity: 2 }]);
  const body = () => ({ ...keys(), expectedVersion: sale.version, reason: "Concurrente", lines: [{ saleLineId: line.id, receivedQuantity: 2, resellableQuantity: 2, damagedQuantity: 0 }] });
  const results = await Promise.allSettled([f.service.returnSale(owner, id, body()), f.service.returnSale(owner, id, body())]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(String((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason?.message), /INVALID_TRANSITION/);
  assert.equal(f.state.items[0].stock, 10); assert.equal(f.state.returnLines.length, 1);
});

test("confirm, deliver, cancel and return responses (and their replays) include the sale lines", async () => {
  const f = fixture(); const a = f.item(10);
  const s = f.draft([{ itemId: a, quantity: 1 }]); const input = confirmInput();
  const c: any = await f.service.confirm(owner, s, input); const replay: any = await f.service.confirm(owner, s, { ...input, requestId: randomUUID() });
  for (const body of [c, replay]) { assert.equal(body.lines.length, 1); assert.ok(Array.isArray(body.returns)); }
  assert.equal(replay.lines[0].unitPrice, "100", "receipt amounts are decimal strings");
  const d: any = await f.service.transition(owner, s, { ...keys(), expectedVersion: c.version, ...f.pay(s) }); assert.equal(d.lines.length, 1);
  const s2 = f.draft([{ itemId: a, quantity: 1 }]); const c2: any = await f.service.confirm(owner, s2, confirmInput());
  const x: any = await f.service.cancel(owner, s2, { ...keys(), expectedVersion: c2.version, reason: "Prueba" }); assert.equal(x.lines.length, 1);
});

test("confirm, deliver, cancel and returns take the account money lock first; two sales of one account serialize on it", { timeout: 5000 }, async () => {
  const f = fixture(); const id = randomUUID(); f.item(10, id);
  const a = f.draft([{ itemId: id, quantity: 1 }]), b = f.draft([{ itemId: id, quantity: 1 }]);
  const [confirmedA] = await Promise.all([f.service.confirm(owner, a, confirmInput()), f.service.confirm(owner, b, confirmInput())]) as any[];
  const delivered = await f.service.transition(owner, a, { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: confirmedA.version, ...f.pay(a) }) as any;
  await f.service.returnSale(owner, a, { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: delivered.version, reason: "Parcial",
    lines: [{ saleLineId: delivered.lines[0].id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] });
  const saleB = f.state.sales.find(sale => sale.id === b)!;
  await f.service.cancel(owner, b, { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: saleB.version as number, reason: "Desistió" });
  const mutations = [...new Set(f.events.filter(event => event.includes(":sale:")).map(event => event.split(":")[0]))];
  assert.equal(mutations.length, 5, "two confirmations, a delivery, a return and a cancellation");
  for (const tx of mutations) {
    const mine = f.events.filter(event => event.startsWith(`${tx}:`)).map(event => event.slice(tx.length + 1));
    assert.equal(mine[0], `money:${owner}`, "the account money lock is the first lock of every sale mutation");
  }
  assert.equal(f.state.items[0]!.stock, 10, "10 − 2 confirmed + 1 returned + 1 cancelled");
});

test("F2a-3c: confirming without payments is rejected and writes nothing; an advance of 0 (payments: []) confirms TRACKED", async () => {
  const f = fixture(); const itemId = f.item(3);
  const sale = f.draft([{ itemId, quantity: 1 }]);
  const { payments: _none, ...withoutPayments } = confirmInput();
  await assert.rejects(f.service.confirm(owner, sale, withoutPayments as any), /PAYMENTS_REQUIRED/);
  assert.deepEqual([f.state.sales[0].status, f.state.items[0].stock, f.state.movements.length, f.state.operations.length], ["DRAFT", 3, 0, 0]);
  const confirmed: any = await f.service.confirm(owner, sale, confirmInput());
  assert.deepEqual([confirmed.status, f.state.sales[0].paymentMode, confirmed.payments.mode, confirmed.payments.balance], ["CONFIRMED", "TRACKED", "TRACKED", 100n]);
});
