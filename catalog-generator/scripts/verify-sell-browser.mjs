import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Vender › Nueva venta (F2a-3a): real Chromium, real Next proxy, simulated API with the rules of
// docs/sales-payments-cartera-contract.md section 17 (F2a-2b): drafts, confirm with payments, fiado off, credit.
// Optional screenshots: SELL_SCREENSHOTS=<folder outside the repo>. Run from C:\ (uppercase) like the other browser tests.
const now = () => new Date().toISOString();
const checks = [], mutations = [], unknown = [];
const item = (name, sku, price, stock, minimumStock = 0) => ({ id: randomUUID(), name, sku, price, stock, minimumStock });
const items = [item("Cargador 20W", "CARG-20W", "45000", 25), item("Audífonos BT", "AUD-BT", "89000", 18), item("Forro iPhone 13", "FOR-IP13", "25000", 2),
  item("Vidrio templado", "VID-TEMP", "15000", 40), item("Cable USB-C", "CAB-USBC", "18000", 0), item("Soporte sin precio", "SOP-SP", null, 5)];
const customers = [{ id: randomUUID(), fullName: "Ana Gómez", phone: "3001234567", credit: 70000n }];
const sales = new Map(), receipts = new Map();
let todayBase = 845000n, dropNextConfirm = false, failReadsAfterConfirm = false;
class Fail extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const byId = id => items.find(i => i.id === id);
const itemView = i => ({ id: i.id, name: i.name, sku: i.sku, stock: i.stock, minimumStock: i.minimumStock, dataVersion: 1, stockVersion: 1,
  commercialTerms: i.price ? { unitSalePrice: i.price, referenceUnitCost: null, currency: "COP", version: 1 } : null });
const customerOf = id => customers.find(c => c.id === id);
function totals(s) {
  s.subtotal = s.lines.reduce((t, l) => t + BigInt(l.unitPrice) * BigInt(l.quantity), 0n);
  s.discountTotal = s.lines.reduce((t, l) => t + BigInt(l.unitDiscount) * BigInt(l.quantity), 0n);
  s.total = s.subtotal - s.discountTotal;
  for (const l of s.lines) l.lineTotal = ((BigInt(l.unitPrice) - BigInt(l.unitDiscount)) * BigInt(l.quantity)).toString();
}
const paidOf = s => s.payments.reduce((t, p) => t + BigInt(p.amount), 0n) + (s.credit ?? 0n);
function view(s) {
  const c = s.customerId ? customerOf(s.customerId) : null;
  const tracked = s.paymentMode === "TRACKED", balance = tracked ? s.total - paidOf(s) : null;
  return { id: s.id, status: s.status, version: s.version, currency: "COP", subtotal: s.subtotal.toString(), discountTotal: s.discountTotal.toString(), total: s.total.toString(),
    createdAt: s.createdAt, confirmedAt: s.confirmedAt ?? null, deliveredAt: s.deliveredAt ?? null, cancelledAt: null, returnedAt: null, paymentMode: s.paymentMode, paymentDueDate: null,
    customerId: s.customerId, customerNameSnapshot: c?.fullName ?? null, customerPhoneSnapshot: c?.phone ?? null, customerEmailSnapshot: null, customerName: c?.fullName ?? null, customerPhone: c?.phone ?? null,
    customer: c ? { id: c.id, fullName: c.fullName, phone: c.phone, archivedAt: null } : null, lines: s.lines.map(l => ({ ...l })), returns: [],
    payments: tracked ? { mode: "TRACKED", creditSalesEnabled: false, total: s.total.toString(), returnedValue: "0", effectiveTotal: s.total.toString(), paid: paidOf(s).toString(), balance: balance.toString(), refundDue: "0",
      stage: s.status === "CONFIRMED" ? (balance > 0n ? "PENDING_ORDER" : "PAID") : "PAID" } : { mode: "LEGACY" } };
}
const hashOf = body => JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "requestId")));

function mutate(method, url, body) {
  const p = url.pathname;
  if (method === "POST" && p === "/api/sales") {
    if (receipts.has(body.operationId)) return { status: 200, body: { result: view(sales.get(receipts.get(body.operationId).saleId)) } };
    if (body.customerId && !customerOf(body.customerId)) throw new Fail(404, "CUSTOMER_NOT_FOUND");
    const s = { id: randomUUID(), status: "DRAFT", version: 1, lines: [], customerId: body.customerId ?? null, paymentMode: "LEGACY", payments: [], credit: 0n, createdAt: now() };
    totals(s); sales.set(s.id, s); receipts.set(body.operationId, { saleId: s.id });
    return { status: 200, body: { result: view(s) } };
  }
  let m = p.match(/^\/api\/sales\/([^/]+)$/);
  if (method === "PATCH" && m) {
    const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND");
    if (receipts.has(body.operationId)) return { status: 200, body: { result: view(s) } };
    if (s.status !== "DRAFT") throw new Fail(409, "INVALID_TRANSITION");
    if (s.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
    if (!Array.isArray(body.lines) || !body.lines.length) throw new Fail(400, "INVALID_SALE_INPUT");
    if (body.customerId !== undefined) s.customerId = body.customerId;
    s.lines = body.lines.map(l => { const i = byId(l.inventoryItemId); if (!i) throw new Fail(400, "ITEM_NOT_FOUND"); if (!i.price) throw new Fail(400, "PRICE_REQUIRED");
      if (BigInt(l.unitDiscount) > BigInt(i.price)) throw new Fail(400, "INVALID_DISCOUNT");
      return { id: randomUUID(), inventoryItemId: i.id, quantity: l.quantity, itemName: i.name, sku: i.sku, unitPrice: i.price, unitDiscount: l.unitDiscount, lineTotal: "0", unitCost: null }; });
    totals(s); s.version++; receipts.set(body.operationId, { saleId: s.id });
    return { status: 200, body: { result: view(s) } };
  }
  m = p.match(/^\/api\/sales\/([^/]+)\/confirm$/);
  if (method === "POST" && m) {
    const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND");
    const prior = receipts.get(body.operationId);
    if (prior) { if (prior.hash !== hashOf(body)) throw new Fail(409, "IDEMPOTENCY_CONFLICT"); return { status: 200, body: { result: prior.reply } }; }
    if (s.status !== "DRAFT" || s.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
    for (const l of s.lines) if (byId(l.inventoryItemId).stock < l.quantity) throw new Fail(409, "STOCK_INSUFFICIENT");
    const payments = body.payments ?? [], credit = BigInt(body.customerCreditAmount ?? "0");
    for (const pay of payments) {
      if (!["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"].includes(pay.method) || !/^[1-9][0-9]*$/.test(pay.amount)) throw new Fail(400, "INVALID_PAYMENT_INPUT");
      if (pay.cashReceived !== undefined && (pay.method !== "CASH" || BigInt(pay.cashReceived) < BigInt(pay.amount))) throw new Fail(400, "INVALID_PAYMENT_INPUT");
    }
    const incoming = payments.reduce((t, x) => t + BigInt(x.amount), 0n) + credit;
    if (incoming > s.total) throw new Fail(409, "PAYMENT_EXCEEDS_BALANCE");
    if (credit > 0n) { const c = customerOf(s.customerId); if (!c) throw new Fail(409, "CUSTOMER_REQUIRED_FOR_CREDIT"); if (c.credit < credit) throw new Fail(409, "CREDIT_INSUFFICIENT"); }
    if (body.deliverImmediately && incoming < s.total) throw new Fail(409, "SALE_BALANCE_DUE");
    // Commit.
    for (const l of s.lines) byId(l.inventoryItemId).stock -= l.quantity;
    if (credit > 0n) customerOf(s.customerId).credit -= credit;
    Object.assign(s, { status: body.deliverImmediately ? "DELIVERED" : "CONFIRMED", confirmedAt: now(), deliveredAt: body.deliverImmediately ? now() : null, paymentMode: "TRACKED", payments, credit, version: s.version + 1 });
    const reply = view(s); receipts.set(body.operationId, { hash: hashOf(body), reply });
    return { status: 200, body: { result: reply } };
  }
  if (method === "POST" && p === "/api/customers") {
    if (typeof body.fullName !== "string" || !body.fullName.trim() || !/^[0-9]{7,15}$/.test(String(body.phone ?? "").replace(/[^0-9]/g, ""))) throw new Fail(400, "INVALID_CUSTOMER_INPUT");
    const c = { id: randomUUID(), fullName: body.fullName.trim(), phone: body.phone.replace(/[^0-9]/g, ""), credit: 0n }; customers.push(c);
    return { status: 201, body: { customer: { id: c.id, fullName: c.fullName, phone: c.phone, email: null, address: null, notes: null, archivedAt: null }, warnings: [] }, raw: true };
  }
  return null;
}
function read(url) {
  const p = url.pathname, q = url.searchParams;
  if (p === "/api/me") return { user: { emailVerifiedAt: now(), hasLocalPassword: true } };
  if (failReadsAfterConfirm && (p === "/api/inventory/items" || p === "/api/dashboard/summary")) throw new Fail(500, "SERVER_ERROR");
  if (p === "/api/inventory/items") {
    const term = (q.get("q") ?? "").toLowerCase();
    return { success: true, result: { items: items.filter(i => !term || i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term)).map(itemView), total: items.length, page: 1 } };
  }
  if (p === "/api/dashboard/summary") {
    const sold = [...sales.values()].filter(s => ["CONFIRMED", "DELIVERED"].includes(s.status)).reduce((t, s) => t + s.total, 0n);
    return { success: true, today: { date: now().slice(0, 10), salesTotal: (todayBase + sold).toString(), salesCount: 0, yesterdaySalesTotal: "0" } };
  }
  if (p === "/api/customers") {
    const term = (q.get("q") ?? "").toLowerCase();
    return { success: true, customers: customers.filter(c => !term || c.fullName.toLowerCase().includes(term) || c.phone.includes(term)).map(c => ({ id: c.id, fullName: c.fullName, phone: c.phone, email: null, archivedAt: null })), hasMore: false, page: 1 };
  }
  let m = p.match(/^\/api\/customers\/([^/]+)\/credit$/);
  if (m) { const c = customerOf(m[1]); if (!c) throw new Fail(404, "CUSTOMER_NOT_FOUND"); return { result: { customerId: c.id, balance: c.credit.toString(), entries: [] } }; }
  m = p.match(/^\/api\/sales\/([^/]+)$/);
  if (m) { const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND"); return { result: view(s) }; }
  return null;
}
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); res.end(JSON.stringify(body)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  try {
    if (req.method === "GET") { const result = read(url); if (!result) { unknown.push(`GET ${url.pathname}`); return reply({}, 404); } return reply(result); }
    const body = raw ? JSON.parse(raw) : {};
    mutations.push({ method: req.method, path: url.pathname, body });
    const result = mutate(req.method, url, body);
    if (!result) { unknown.push(`${req.method} ${url.pathname}`); return reply({}, 404); }
    if (dropNextConfirm && url.pathname.endsWith("/confirm")) { dropNextConfirm = false; req.socket.destroy(); return; } // committed, reply lost
    return reply(result.raw ? { success: true, ...result.body } : result.body, result.status);
  } catch (error) {
    if (error instanceof Fail) return reply({ success: false, error: error.code, message: error.code }, error.status);
    throw error;
  }
}

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const text = () => evaluate("document.body.innerText");
    const norm = value => value.replace(/\s+/g, " ");
    const waitFor = async (expression, label) => { try { await poll(() => evaluate(`Boolean(${expression})`)); } catch { throw new Error(`No se cumplió: ${label}\n--- pantalla ---\n${(await text()).slice(0, 2500)}`); } };
    const waitText = value => waitFor(`document.body.innerText.replace(/\\s+/g," ").includes(${JSON.stringify(value)})`, value);
    const ticket = `document.querySelector('aside[aria-label="Ticket de la venta"]')`;
    const inTicket = selector => `${ticket}?.querySelector(${JSON.stringify(selector)})`;
    const byLabel = label => `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}&&b.getClientRects().length)`;
    const byText = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s+/g," ").trim()===${JSON.stringify(label)}&&b.getClientRects().length)`;
    const click = async (expression, label) => { await waitFor(`(()=>{const b=${expression};return b&&!b.disabled})()`, `botón ${label}`); await evaluate(`${expression}.click()`); };
    const tap = label => click(byLabel(label), label);
    const press = label => click(byText(label), label);
    const total = () => evaluate(`${inTicket("[data-ticket-total]")}?.textContent.replace(/\\s+/g," ")`);
    const waitTotal = async value => { try { await poll(async () => (await total()) === value); } catch { throw new Error(`Total esperado ${value}, en pantalla ${await total()}`); } };
    const charge = `${inTicket("[data-charge]")}`;
    const key = async (name, code, vk) => { for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk }); };
    const viewport = async width => { await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await new Promise(r => setTimeout(r, 350)); };
    const shot = async name => { const folder = process.env.SELL_SCREENSHOTS; if (!folder) return; const { data } = await command("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, "base64")); };
    const confirms = () => mutations.filter(m => m.path.endsWith("/confirm"));
    const lastSale = () => [...sales.values()].at(-1);
    const newSale = async () => { await press("Nueva venta"); await waitText("El ticket está vacío"); };

    // Opening: tabs, products with one availability fact, the dashed «Producto nuevo», empty ticket and the bottom bar.
    await viewport(1440);
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/ventas" });
    await waitText("El ticket está vacío"); await waitText("Audífonos BT");
    await waitFor(`document.querySelector('[data-today-sales]')?.textContent.replace(/\\s+/g," ")==="$ 845.000"`, "ventas de hoy");
    const page = norm(await text());
    for (const part of ["Vender", "Selecciona productos y arma tu venta", "Nueva venta", "Pedidos", "Historial", "Ticket", "Producto nuevo", "Agregar al inventario", "Sistema en línea", "Ventas hoy:", "Atajo: F1 para buscar",
      "Quedan 2", "Agotado", "25 disponibles", "Sin precio"]) assert.ok(page.includes(part), part);
    for (const absent of ["Fiado", "Bodega", "Celulares", "Accesorios", "Repuestos", "Inventario ▾"]) assert.ok(!page.includes(absent), `${absent} must not appear in this phase`);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('nav[aria-label="Vender"] a')].map(a=>[a.textContent.trim(),a.getAttribute('href'),a.getAttribute('aria-current')])`),
      [["Nueva venta", "/dashboard/ventas", "page"], ["Pedidos", "/dashboard/catalogos", null], ["Historial", "/dashboard/ventas/historial", null]]);
    assert.equal(await evaluate(`document.querySelector('aside nav[aria-label="Principal"] a[href="/dashboard/ventas"]')?.getAttribute('aria-current')`), "page", "common side menu");
    assert.equal(await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Producto nuevo'))?.getAttribute('href')`), "/dashboard/inventario");
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-product]')].map(c=>[c.dataset.product,c.querySelector('[data-availability]')?.dataset.availability])`),
      [["CARG-20W", "ok"], ["AUD-BT", "ok"], ["FOR-IP13", "low"], ["VID-TEMP", "ok"], ["CAB-USBC", "out"], ["SOP-SP", "ok"]]);
    assert.equal(await evaluate(`${byLabel("Cable USB-C: agotado")}.disabled`), true, "sold out cannot be added");
    assert.equal(await evaluate(`${byLabel("Soporte sin precio: sin precio, configúralo en Inventario")}.disabled`), true, "no price cannot be added");
    assert.equal(await evaluate(`${charge}.disabled`), true); assert.ok(page.includes("Agrega productos al ticket."));
    assert.deepEqual(mutations, [], "opening writes nothing");
    checks.push("Opening: tabs (Pedidos and Historial link to the current views), common side menu, one availability fact per card, sold-out and price-less products blocked, «Producto nuevo» to Inventario, empty ticket, bottom bar with today's sales; no fiado, categories or warehouse");

    // Cash sale with change: the total and the line come from the server draft.
    await tap("Agregar Audífonos BT al ticket");
    await waitTotal("$ 89.000");
    await waitFor(`${inTicket("[data-draft-state]")}?.dataset.draftState==="saved"`, "borrador guardado");
    assert.equal(await evaluate(`document.querySelector('[data-product="AUD-BT"]').innerText.includes('En el ticket: 1')`), true, "card shows it is in the ticket");
    assert.equal(sales.size, 1); assert.equal(lastSale().status, "DRAFT");
    await shot("1440-ticket");
    await tap("Agregar pago: Efectivo");
    await waitFor(`${inTicket('[data-payment-row="CASH"] input')}?.value==="89.000"`, "fila de efectivo con lo que falta");
    await fill(`aside[aria-label="Ticket de la venta"] [data-payment-row="CASH"] input[id$="-received"]`, "100000");
    await waitFor(`${inTicket("[data-cash-change]")}?.textContent.replace(/\\s+/g," ")==="$ 11.000"`, "cambio");
    await waitFor(`${inTicket("[data-payment-status]")}?.textContent.includes("Completo")`, "completo");
    assert.equal(norm(await evaluate(`${charge}.textContent`)), "Cobrar y entregar · $ 89.000");
    await click(charge, "Cobrar y entregar");
    await waitText("Venta entregada · $ 89.000 · Cambio $ 11.000");
    let s = lastSale();
    assert.deepEqual([s.status, s.paymentMode, s.payments], ["DELIVERED", "TRACKED", [{ method: "CASH", amount: "89000", cashReceived: "100000" }]]);
    assert.equal(byId(items[1].id).stock, 17);
    assert.equal(confirms().length, 1); assert.equal(confirms()[0].body.deliverImmediately, true);
    await waitFor(`document.querySelector('[data-today-sales]')?.textContent.replace(/\\s+/g," ")==="$ 934.000"`, "ventas de hoy actualizadas");
    assert.equal(await evaluate(`document.activeElement?.textContent.trim()`), "Nueva venta", "focus on «Nueva venta»");
    await shot("1440-done");
    checks.push("Cash sale: + adds to a server draft («Borrador guardado», server total $ 89.000); Efectivo proposes what is missing; Recibido 100.000 → Cambio $ 11.000; «Cobrar y entregar · $ 89.000» is one confirm call with deliverImmediately and the payment; summary with the change; stock and today's sales updated");

    // Mixed payment: cash + transfer (Daviplata).
    await newSale();
    await tap("Agregar Forro iPhone 13 al ticket"); await tap("Agregar una unidad de Forro iPhone 13");
    await tap("Agregar Vidrio templado al ticket");
    await waitTotal("$ 65.000");
    assert.equal(await evaluate(`${byLabel("Agregar una unidad de Forro iPhone 13")}.disabled`), true, "cannot add beyond the 2 in stock");
    await tap("Agregar pago: Efectivo");
    await fill(`aside[aria-label="Ticket de la venta"] [data-payment-row="CASH"] input:not([id$="-received"])`, "40000");
    await waitFor(`${inTicket("[data-payment-status]")}?.textContent.replace(/\\s+/g," ").includes("Falta $ 25.000")`, "falta");
    assert.equal(await evaluate(`${charge}.disabled`), true, "incomplete: Cobrar y entregar disabled");
    await tap("Agregar pago: Transferencia");
    await waitFor(`${inTicket('[data-payment-row="NEQUI"] input')}?.value==="25.000"`, "transferencia con el resto");
    await click(`[...${ticket}.querySelectorAll('[role="radio"]')].find(b=>b.textContent.trim()==="Daviplata")`, "Daviplata");
    await waitFor(`${inTicket('[data-payment-row="DAVIPLATA"]')}`, "Daviplata elegido");
    assert.equal(await evaluate(`document.querySelector('[data-product="VID-TEMP"] [data-availability]')`), null, "in the ticket: the card says «En el ticket»");
    // The reads after the sale fail: the cards and «Ventas hoy» must change anyway, from the confirmed sale.
    failReadsAfterConfirm = true;
    await click(charge, "Cobrar y entregar");
    await waitText("Venta entregada · $ 65.000");
    s = lastSale();
    assert.deepEqual(s.payments, [{ method: "CASH", amount: "40000" }, { method: "DAVIPLATA", amount: "25000" }]);
    assert.equal(byId(items[2].id).stock, 0);
    await waitFor(`document.querySelector('[data-product="FOR-IP13"] [data-availability="out"]')?.textContent.includes("Agotado")`, "Agotado sin recargar");
    await waitFor(`document.querySelector('[data-product="VID-TEMP"] [data-availability="ok"]')?.textContent.includes("39 disponibles")`, "39 disponibles sin recargar");
    await waitFor(`document.querySelector('[data-today-sales]')?.textContent.replace(/\\s+/g," ")==="$ 999.000"`, "ventas de hoy sin recargar");
    failReadsAfterConfirm = false;
    checks.push("Mixed payment: Efectivo 40.000 + Transferencia (Daviplata) with the remaining 25.000; incomplete payments keep «Cobrar y entregar» disabled; + stops at the stock; right after the sale, without reloading and even if the reads fail, the cards say «Agotado» / «39 disponibles» and «Ventas hoy» adds the sale");

    // Pending balance: delivery blocked and explained; confirm and deliver later with an advance.
    await newSale();
    await waitFor(`document.querySelector('[data-product="FOR-IP13"] [data-availability="out"]')`, "productos recargados tras la venta");
    await tap("Agregar Cargador 20W al ticket");
    await waitTotal("$ 45.000");
    await tap("Agregar pago: Efectivo");
    await fill(`aside[aria-label="Ticket de la venta"] [data-payment-row="CASH"] input:not([id$="-received"])`, "10000");
    await waitText("Falta $ 35.000. Por ahora la venta se entrega pagada por completo");
    assert.equal(await evaluate(`${charge}.disabled`), true);
    assert.equal(await evaluate(`${charge}.getAttribute('aria-describedby')`), "desk-charge-why", "the reason is linked to the button");
    await press("Confirmar, entregar después");
    await waitText("Venta confirmada · $ 45.000"); await waitText("Pagado $ 10.000 · Falta $ 35.000 para entregar");
    s = lastSale();
    assert.deepEqual([s.status, s.paymentMode, s.payments], ["CONFIRMED", "TRACKED", [{ method: "CASH", amount: "10000" }]]);
    assert.equal(confirms().at(-1).body.deliverImmediately, false);
    checks.push("Pending balance: «Cobrar y entregar» disabled with the reason (fiado off); «Confirmar, entregar después» confirms with a 10.000 advance and shows what is missing");

    // Customer: search, credit balance as a payment method (never above what is available).
    await newSale();
    await fill("#desk-customer-q", "Ana"); await key("Enter", "Enter", 13);
    await click(`[...document.querySelectorAll('[aria-label="Clientes encontrados"] button')].find(b=>b.textContent.includes('Ana Gómez'))`, "Ana Gómez");
    await waitText("Saldo a favor del cliente: $ 70.000");
    await tap("Agregar Audífonos BT al ticket");
    await waitTotal("$ 89.000");
    await tap("Agregar pago: Saldo a favor");
    await waitFor(`${inTicket('[data-payment-row="CREDIT"] input')}?.value==="70.000"`, "saldo a favor propuesto");
    await fill(`aside[aria-label="Ticket de la venta"] [data-payment-row="CREDIT"] input`, "80000");
    await waitText("El saldo a favor disponible es $ 70.000.");
    await fill(`aside[aria-label="Ticket de la venta"] [data-payment-row="CREDIT"] input`, "70000");
    await tap("Agregar pago: Efectivo");
    await waitFor(`${inTicket('[data-payment-row="CASH"] input')}?.value==="19.000"`, "efectivo por el resto");
    await click(charge, "Cobrar y entregar");
    await waitText("Venta entregada · $ 89.000");
    s = lastSale();
    assert.deepEqual([s.customerId, s.credit, s.payments], [customers[0].id, 70000n, [{ method: "CASH", amount: "19000" }]]);
    assert.equal(customers[0].credit, 0n);
    assert.equal(confirms().at(-1).body.customerCreditAmount, "70000");
    checks.push("Saldo a favor: searching the customer shows her 70.000; the row proposes it, more than available is rejected, the rest in cash; sent as customerCreditAmount");

    // Create a customer with the existing POST /customers.
    await newSale();
    await tap("Crear cliente");
    await fill("#desk-new-name", "Luis Pérez"); await fill("#desk-new-phone", "310 555 0101");
    await press("Crear y usar en la venta");
    await waitFor(`${inTicket("[data-ticket-customer]")}?.innerText.includes("Luis Pérez")`, "cliente creado");
    assert.equal(await evaluate(`Boolean(${byLabel("Agregar pago: Saldo a favor")})`), false, "no credit: no «Saldo a favor»");
    checks.push("Creating a customer from the ticket uses POST /customers and links it; without credit there is no «Saldo a favor»");

    // Insufficient stock (another sale took it): clear error, products reloaded.
    await tap("Quitar al cliente Luis Pérez");
    await tap("Agregar Vidrio templado al ticket");
    await waitTotal("$ 15.000");
    byId(items[3].id).stock = 0;
    await tap("Agregar pago: Tarjeta");
    await click(charge, "Cobrar y entregar");
    await waitText("No hay existencias suficientes");
    assert.equal(lastSale().status, "DRAFT", "nothing confirmed");
    await press("Entendido");
    await waitFor(`document.querySelector('[data-product="VID-TEMP"] [data-availability="out"]')`, "agotado tras recargar");
    await waitFor(`${inTicket("[data-line-short]")}?.textContent.startsWith("Agotado")`, "la línea avisa que se agotó");
    checks.push("STOCK_INSUFFICIENT: Spanish message, nothing confirmed; products reloaded show «Agotado» on the card and on the ticket line");

    // Lost reply after commit: «Reintentar» resends the same operationId; one sale, stock once.
    await tap("Quitar Vidrio templado del ticket");
    await tap("Agregar Cargador 20W al ticket");
    await waitTotal("$ 45.000");
    const stockBefore = byId(items[0].id).stock;
    const cardRow = `aside[aria-label="Ticket de la venta"] [data-payment-row="CARD"] input`;
    if (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(cardRow)}))`))) await tap("Agregar pago: Tarjeta");
    await fill(cardRow, "45000");
    dropNextConfirm = true;
    await click(charge, "Cobrar y entregar");
    // Through the Next proxy a reply lost after the commit arrives as a server error; both say the retry won't duplicate.
    await waitText("Reintenta: se enviará la misma operación y no se duplicará.");
    await press("Reintentar");
    await waitText("Venta entregada · $ 45.000");
    const [lost, retried] = confirms().slice(-2);
    assert.equal(lost.body.operationId, retried.body.operationId, "same operationId"); assert.notEqual(lost.body.requestId, retried.body.requestId, "new requestId");
    assert.equal(byId(items[0].id).stock, stockBefore - 1, "stock discounted once");
    checks.push("Lost reply: retry message, «Reintentar» resends the same operationId with a new requestId; the receipt answers, stock discounted once");

    // Draft survives a reload; keyboard: F1, Tab, Escape.
    await newSale();
    await tap("Agregar Cargador 20W al ticket"); await waitTotal("$ 45.000");
    await command("Page.reload");
    await waitTotal("$ 45.000"); await waitText("Borrador guardado");
    assert.equal(sales.size, [...sales.values()].length);
    await evaluate(`document.body.focus()`);
    await key("F1", "F1", 112);
    assert.equal(await evaluate(`document.activeElement?.id`), "sell-search", "F1 focuses the search");
    await key("Tab", "Tab", 9);
    assert.notEqual(await evaluate(`document.activeElement?.id`), "sell-search", "Tab moves on");
    await fill("#desk-customer-q", "Ana"); await key("Enter", "Enter", 13);
    await waitFor(`document.querySelector('[aria-label="Clientes encontrados"]')`, "resultados");
    await evaluate(`document.querySelector('#desk-customer-q').focus()`);
    await key("Escape", "Escape", 27);
    await waitFor(`!document.querySelector('[aria-label="Clientes encontrados"]')`, "Escape cierra los resultados");
    await fill("#sell-search", "vidrio");
    await waitFor(`document.querySelectorAll('[data-product]').length===1`, "búsqueda por nombre");
    await fill("#sell-search", "CARG");
    await waitFor(`document.querySelector('[data-product]')?.dataset.product==="CARG-20W"`, "búsqueda por SKU");
    await fill("#sell-search", "");
    checks.push("The ticket survives a reload (server draft); F1 focuses the search, Tab moves on, Escape closes the customer results; search by name or SKU");

    // No old green on the page or the mobile ticket sheet (control element first).
    const OLD = ["#0F6B57", "#0B5646", "#E8F3EF", "#0B2E27", "#EDF3EC", "#D6DFD7", "#E2E8E0", "#A8C2AF", "#52655A", "#68756E", "#FCFDFB", "#52675B", "#DCE4DC", "#F3F5F2", "#CFD6CF", "#3F4A43",
      "#B8DCC6", "#ECF7F0", "#1F5B37", "#5A886C", "#2F7A52", "#F2FAF4", "#9FC4AE", "#C3E5D4", "#B8DEC8", "#37443D", "#87928B", "#D9E2D9"]
      .map(h => `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`);
    const noOldGreen = async label => {
      const found = await evaluate(`(()=>{const old=${JSON.stringify(OLD)};const out=[];for(const root of document.querySelectorAll('main,[role="dialog"]'))for(const e of [root,...root.querySelectorAll('*')]){const cs=getComputedStyle(e);for(const p of ['color','backgroundColor','borderTopColor','borderBottomColor','outlineColor']){const v=cs[p].replaceAll(' ','');if(old.includes(v))out.push((e.id||e.tagName)+' '+p+' '+v)}}return out.slice(0,8)})()`);
      assert.deepEqual(found, [], `old green on ${label}`);
    };
    await evaluate(`(()=>{const p=document.createElement('p');p.id='old-green-control';p.style.color='#0F6B57';document.querySelector('main').append(p)})()`);
    await assert.rejects(noOldGreen("the control"), /old green on the control/);
    await evaluate(`document.querySelector('#old-green-control').remove()`);
    await noOldGreen("Vender");
    checks.push("No old green on the page (computed styles), with a positive control");

    // Responsive 320–1440: no horizontal overflow; mobile: products first, ticket as a bottom sheet with a fixed total.
    for (const width of [320, 375, 414, 768, 1024, 1132, 1280, 1440]) {
      await viewport(width);
      const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      const wide = overflow > 0 ? await evaluate(`[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-4).map(e=>e.tagName+'.'+String(e.className).slice(0,50))`) : [];
      assert.ok(overflow <= 0, `overflow ${overflow}px at ${width}px: ${JSON.stringify(wide)}`);
      const mobile = width < 1024;
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-open-ticket]').getClientRects().length)`), mobile, `ticket bar at ${width}`);
      assert.equal(await evaluate(`Boolean(${ticket}.getClientRects().length)`), !mobile, `ticket column at ${width}`);
      if (width === 375 || width === 1132 || width === 1440) await shot(`${width}`);
    }
    // Ticket forms open (Crear cliente, Transferencia with its selector, Efectivo with Recibido/Cambio, Pagar el total):
    // one field per row, nothing past the edge of the ticket column or the sheet, 320–1440 px (F2a-3b, fix A.1).
    const outside = root => `(()=>{const r=${root}.getBoundingClientRect();return [...${root}.querySelectorAll('input,button,label,output,[role="radiogroup"]')].filter(e=>e.getClientRects().length).filter(e=>{const b=e.getBoundingClientRect();return b.right>r.right+0.5||b.left<r.left-0.5}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().right)+'>'+Math.round(r.right)).slice(0,5)})()`;
    for (const width of [320, 375, 414, 768, 1024, 1110, 1132, 1280, 1440]) {
      await viewport(width);
      const mobile = width < 1024, prefix = mobile ? "sheet" : "desk", root = mobile ? `document.querySelector('[role="dialog"]')` : ticket;
      if (mobile) { await click(`document.querySelector('[data-open-ticket]')`, "ver ticket"); await waitFor(`${root}?.querySelector('[data-ticket-total]')`, "hoja del ticket"); }
      if (!(await evaluate(`Boolean(document.querySelector('#${prefix}-new-name'))`))) await click(`[...${root}.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Crear cliente')`, "Crear cliente");
      if (!(await evaluate(`Boolean(${root}.querySelector('[data-payment-row="NEQUI"]'))`))) await click(`[...${root}.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Agregar pago: Transferencia')`, "Transferencia");
      if (!(await evaluate(`Boolean(${root}.querySelector('[data-payment-row="CASH"]'))`))) await click(`[...${root}.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Agregar pago: Efectivo')`, "Efectivo");
      await fill(`#${prefix}-new-phone`, "3105550101 extensión larga 1234");
      await evaluate(`(()=>{const i=${root}.querySelector('[data-payment-row="CASH"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'90.000');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await waitFor(`${root}.querySelector('[data-pay-total]')`, "Pagar el total");
      assert.deepEqual(await evaluate(outside(root)), [], `ticket forms inside the column at ${width}px`);
      const [name, phone] = await evaluate(`[document.querySelector('#${prefix}-new-name').getBoundingClientRect(),document.querySelector('#${prefix}-new-phone').getBoundingClientRect()].map(r=>({top:r.top,bottom:r.bottom,left:r.left,width:r.width}))`);
      assert.ok(phone.top >= name.bottom && Math.abs(phone.left - name.left) < 1 && Math.abs(phone.width - name.width) < 1, `Nombre over Teléfono, same width, at ${width}px`);
      assert.ok(await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`) <= 0, `no page overflow with the forms open at ${width}px`);
      if (width === 1110) await shot("1110-crear-cliente");
      if (mobile) { await click(`${root}.querySelector('button[aria-label="Cerrar"]')`, "cerrar hoja"); await waitFor(`!document.querySelector('[role="dialog"]')`, "hoja cerrada"); }
    }
    // «Pagar el total» trims the payments to exactly the total (the change grows); then the rows are removed.
    await viewport(1440);
    await click(`${inTicket("[data-pay-total]")}`, "Pagar el total");
    await waitFor(`${inTicket("[data-payment-status]")}?.textContent.includes("Completo")`, "completo tras pagar el total");
    assert.deepEqual(await evaluate(`[...${ticket}.querySelectorAll('[data-payment-row]')].map(r=>[r.dataset.paymentRow,r.querySelector('input').value])`), [["NEQUI", "45.000"]], "the transfer covers the total; the cash row is dropped");
    await tap("Quitar pago 1 (Nequi)");
    await tap("Crear cliente");
    checks.push("Ticket forms open (Crear cliente, Transferencia with Nequi/Daviplata/Banco, Efectivo with Recibido and Cambio, Pagar el total) stay inside the ticket column or the sheet, Nombre above Teléfono at full width, 320–1440 px including 1110 and 1132; «Pagar el total» trims the rows to the total");

    await viewport(375);
    assert.ok(norm(await evaluate(`document.querySelector('[data-open-ticket]').textContent`)).includes("Ticket · 1 producto$ 45.000"));
    await click(`document.querySelector('[data-open-ticket]')`, "ver ticket");
    await waitFor(`document.querySelector('[role="dialog"] [data-ticket-total]')?.textContent.replace(/\\s+/g," ")==="$ 45.000"`, "hoja del ticket");
    await noOldGreen("the ticket sheet");
    assert.ok(await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`) <= 0, "sheet without overflow");
    await shot("375-ticket");
    await key("Escape", "Escape", 27);
    await waitFor(`!document.querySelector('[role="dialog"]')`, "Escape cierra la hoja");
    checks.push("Responsive 320–1440 px without overflow; under 1024 px the ticket is a bottom sheet opened from a fixed bar with the server total; Escape closes it");

    assert.deepEqual(unknown, [], "every request was expected");
    assert.ok(mutations.every(m => m.method !== "POST" || !m.path.endsWith("/confirm") || (m.body.operationId && m.body.requestId)), "confirm carries operationId and requestId");
  });
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message.slice(0, 2500) : String(error), checks }, null, 2));
  process.exitCode = 1;
}
