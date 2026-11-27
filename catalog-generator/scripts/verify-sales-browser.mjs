import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Vender › Historial (F2a-3b) with the sales rules of contract v2.1 on sales without payments (LEGACY): deliver, cancel
// with a reason, cumulative partial returns, conflicts, lost replies, keyboard and widths. Real Chromium, real Next
// proxy, simulated API. Drafts are built and confirmed in Nueva venta (test:sell-browser); payments in test:sale-detail-browser.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let clock = Date.parse("2026-11-20T15:00:00.000Z");
const stamp = () => new Date(clock += 3600000).toISOString();
const items = [
  { id: randomUUID(), name: "Cargador USB-C", sku: "CARG-1", stock: 3 },
  { id: randomUUID(), name: "Funda", sku: "FUN-1", stock: 0 },
];
const customer = { id: randomUUID(), fullName: "Ana Prueba", phone: "3000000000", email: null, archivedAt: null };
const sales = new Map(), operations = new Map(), mutations = [], unknown = [], checks = [];
let dropNextAfterCommit = false, force409 = null;
const json = v => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);
const view = sale => ({ ...sale, customer: sale.customerId ? customer : null, payments: { mode: "LEGACY" } });
const withoutKeys = body => Object.fromEntries(Object.entries(body).filter(([key]) => key !== "operationId" && key !== "requestId"));
class Fail extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
function seed(status, lines, extra = {}) {
  const sale = { id: randomUUID(), status, version: 2, currency: "COP", createdAt: stamp(), confirmedAt: status === "DRAFT" ? null : stamp(), deliveredAt: status === "DELIVERED" ? stamp() : null,
    cancelledAt: null, returnedAt: null, customerId: null, customerNameSnapshot: null, customerPhoneSnapshot: null, customerEmailSnapshot: null, customerName: null, customerPhone: null, sourceOrderId: null,
    paymentMode: "LEGACY", returns: [], lines: lines.map(([sku, quantity, price, discount = 0n]) => { const it = items.find(i => i.sku === sku);
      return { id: randomUUID(), inventoryItemId: it.id, quantity, itemName: it.name, sku, unitPrice: price, unitDiscount: discount, lineTotal: (price - discount) * BigInt(quantity), unitCost: null }; }), ...extra };
  sale.subtotal = sale.lines.reduce((s, l) => s + l.unitPrice * BigInt(l.quantity), 0n);
  sale.discountTotal = sale.lines.reduce((s, l) => s + l.unitDiscount * BigInt(l.quantity), 0n);
  sale.total = sale.subtotal - sale.discountTotal;
  sales.set(sale.id, sale); return sale;
}
function replayOrRecord(body, action, saleId, work) {
  if (!uuid.test(body.operationId ?? "") || !uuid.test(body.requestId ?? "")) throw new Fail(400, "INVALID_SALE_INPUT");
  const hash = JSON.stringify({ action, saleId, content: withoutKeys(body) }), previous = operations.get(body.operationId);
  if (previous) { if (previous.hash !== hash) throw new Fail(409, "IDEMPOTENCY_CONFLICT"); return previous.response; }
  const response = work(); operations.set(body.operationId, { hash, response }); return response;
}
function mutate(method, p, body) {
  const m = p.match(/^\/api\/sales\/([^/]+)\/(deliver|cancel|returns)$/);
  if (method !== "POST" || !m) return null;
  const sale = sales.get(m[1]); if (!sale) throw new Fail(404, "NOT_FOUND");
  const action = m[2];
  if (!operations.has(body.operationId) && force409) { const code = force409; force409 = null; throw new Fail(409, code); }
  return replayOrRecord(body, action, sale.id, () => {
    if ("payments" in body || "customerCreditAmount" in body || "refundNow" in body) throw new Fail(409, "LEGACY_SALE_PAYMENTS_UNSUPPORTED");
    if (action === "deliver") {
      if (sale.status !== "CONFIRMED" || sale.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
      Object.assign(sale, { status: "DELIVERED", deliveredAt: stamp() });
    } else if (action === "cancel") {
      if (sale.status !== "CONFIRMED" || sale.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
      if (!body.reason || body.reason.trim().length < 3) throw new Fail(400, "INVALID_SALE_INPUT");
      for (const l of sale.lines) items.find(i => i.id === l.inventoryItemId).stock += l.quantity;
      Object.assign(sale, { status: "CANCELLED", cancelledAt: stamp() });
    } else {
      if (sale.status !== "DELIVERED" || sale.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
      const returned = id => sale.returns.flatMap(r => r.lines).filter(l => l.saleLineId === id).reduce((s, l) => s + l.receivedQuantity, 0);
      for (const l of body.lines) { const line = sale.lines.find(x => x.id === l.saleLineId); if (!line) throw new Fail(400, "RETURN_LINE_NOT_FOUND"); if (returned(line.id) + l.receivedQuantity > line.quantity) throw new Fail(409, "RETURN_EXCEEDS_SOLD"); if (l.resellableQuantity + l.damagedQuantity !== l.receivedQuantity) throw new Fail(400, "INVALID_SALE_INPUT"); }
      for (const l of body.lines) if (l.resellableQuantity) items.find(i => i.id === sale.lines.find(x => x.id === l.saleLineId).inventoryItemId).stock += l.resellableQuantity;
      sale.returns.push({ id: randomUUID(), saleId: sale.id, reason: body.reason, createdAt: stamp(), operationId: body.operationId, lines: body.lines.map(l => ({ id: randomUUID(), ...l })) });
      if (sale.lines.every(l => returned(l.id) === l.quantity)) Object.assign(sale, { status: "RETURNED", returnedAt: stamp() });
    }
    sale.version++; return { result: { ...view(sale), customer: undefined } };
  });
}
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(json(body)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  if (req.method === "GET") {
    if (url.pathname === "/api/me") return reply({ user: { emailVerifiedAt: "2026-11-01T00:00:00Z", hasLocalPassword: true } });
    if (url.pathname === "/api/sales") return reply({ result: [...sales.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(view) });
    const one = url.pathname.match(/^\/api\/sales\/([^/]+)$/);
    if (one) { const sale = sales.get(one[1]); return sale ? reply({ result: view(sale) }) : reply({ error: "NOT_FOUND", message: "NOT_FOUND" }, 404); }
    unknown.push(`GET ${url.pathname}`); return reply({}, 404);
  }
  const body = raw ? JSON.parse(raw) : {};
  mutations.push({ method: req.method, path: url.pathname, body });
  try {
    const result = mutate(req.method, url.pathname, body);
    if (!result) { unknown.push(`${req.method} ${url.pathname}`); return reply({}, 404); }
    if (dropNextAfterCommit) { dropNextAfterCommit = false; req.socket.destroy(); return; } // committed, reply lost
    return reply(result);
  } catch (error) {
    if (error instanceof Fail) return reply({ error: error.code, message: error.code }, error.status);
    throw error;
  }
}

// Seed (oldest first): a delivered sale with two lines, one to cancel, one to deliver, one for the transition conflict, a draft.
const delivered = seed("DELIVERED", [["CARG-1", 3, 45000n], ["FUN-1", 1, 20000n, 2000n]], { customerId: customer.id, customerNameSnapshot: "Ana Prueba", customerPhoneSnapshot: "3000000000" });
const toCancel = seed("CONFIRMED", [["CARG-1", 2, 45000n]]);
const toDeliver = seed("CONFIRMED", [["FUN-1", 1, 9007199254740993n]]);
const conflict = seed("CONFIRMED", [["CARG-1", 1, 45000n]]);
const draft = seed("DRAFT", [["CARG-1", 1, 45000n]]);

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll }) => {
    const text = () => evaluate("document.body.innerText.replace(/\\s+/g,' ')");
    const waitFor = async (expression, label) => { try { await poll(() => evaluate(`Boolean(${expression})`)); } catch { throw new Error(`No se cumplió: ${label}\n--- pantalla ---\n${(await text()).slice(-1500)}`); } };
    const waitText = value => waitFor(`document.body.innerText.replace(/\\s+/g," ").includes(${JSON.stringify(value)})`, value);
    const panel = `document.querySelector('[data-detail-panel]')`;
    const button = label => `[...${panel}.querySelectorAll('button,a')].find(b=>(b.getAttribute('aria-label')??b.textContent).replace(/\\s+/g," ").trim()===${JSON.stringify(label)})`;
    const click = async (expression, label) => { await waitFor(`(()=>{const b=${expression};return b&&!b.disabled})()`, `botón ${label}`); await evaluate(`${expression}.click()`); };
    const press = label => click(button(label), label);
    const doublePress = async (expression, label) => { await waitFor(`(()=>{const b=${expression};return b&&!b.disabled})()`, label); await evaluate(`(()=>{const b=${expression};b.click();b.click()})()`); };
    const row = id => `document.querySelector('[data-sale-row="${id}"]')`;
    const synced = sale => waitFor(`document.querySelector('[data-sale-detail="${sale.id}"]')?.dataset.saleVersion==="${sale.version}"`, `versión ${sale.version}`);
    const open = async sale => { await click(row(sale.id), `fila ${sale.id}`); await synced(sale); };
    const count = p => mutations.filter(m => m.path === p).length;
    const setValue = async (selector, value) => evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const shot = async (name, width = 1440) => {
      const folder = process.env.SALES_SCREENSHOTS; if (!folder) return;
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise(resolve => setTimeout(resolve, 300));
      const { data } = await command("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(folder, `${name}-${width}.png`), Buffer.from(data, "base64"));
    };

    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/ventas/historial" });
    await waitFor(`${row(delivered.id)}`, "lista");
    assert.equal(await evaluate(`document.querySelector('aside nav[aria-label="Principal"] a[href="/dashboard/ventas"]')?.getAttribute('aria-current')`), "page", "Vender is the active entry");
    assert.deepEqual(mutations, [], "no writes on load");
    // The list: date, customer, items, COP totals (BigInt beyond 2^53) and Spanish status labels; LEGACY without figures.
    const listed = await evaluate(`[...document.querySelectorAll('[data-sale-row]')].map(b=>b.innerText.replace(/\\s+/g,' '))`);
    assert.equal(listed.length, 5);
    assert.ok(listed[2].includes("Sin cliente") && listed[2].includes("1 artículo") && listed[2].includes("$ 9.007.199.254.740.993") && listed[2].includes("Confirmada"), listed[2]);
    assert.ok(listed[4].includes("Ana Prueba") && listed[4].includes("4 artículos") && listed[4].includes("$ 153.000") && listed[4].includes("Entregada") && listed[4].includes("sin registro de pagos"), listed[4]);
    assert.ok(listed[0].includes("Borrador"));
    await evaluate(`(()=>{const s=document.querySelector('#history-status');s.value='CONFIRMED';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===3`, "filtro Confirmada");
    await evaluate(`(()=>{const s=document.querySelector('#history-status');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===5`, "todas");
    checks.push("List: date, customer or «Sin cliente», items, COP totals beyond 2^53, Spanish status labels and «sin registro de pagos» on LEGACY sales; status filter; no writes on load");

    // Keyboard: Tab from the status filter reaches the customer filter and then the sales list, with visible focus.
    await evaluate(`document.querySelector('#history-status').focus()`);
    const tabTo = async () => { await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); };
    await tabTo(); assert.equal(await evaluate(`document.activeElement?.id`), "history-customer-q");
    await tabTo(); await tabTo();
    assert.ok(await evaluate(`Boolean(document.activeElement?.dataset.saleRow)`), "the sales list follows the filters");
    assert.notEqual(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), "none", "visible focus");
    checks.push("Keyboard: Tab goes from the status filter to the customer filter and then to the sales list, with a visible focus outline");

    // Open a sale: detail with its lines, focus on the heading.
    await open(delivered);
    assert.equal(await evaluate(`document.activeElement?.id`), "sale-detail-title");
    const detail = await evaluate(`${panel}.innerText.replace(/\\s+/g,' ')`);
    for (const part of ["Cargador USB-C", "3 × $ 45.000", "Funda", "desc. $ 2.000 c/u", "Pago no registrado (venta anterior al registro de pagos).", "Registrar devolución"]) assert.ok(detail.includes(part), part);
    checks.push("Click opens the detail at the right with the lines saved in the sale (price, discount) and focus on its heading; LEGACY: «Pago no registrado»");

    // Partial return: capped at the pending units on screen, 409 RETURN_EXCEEDS_SOLD, then the rest → RETURNED.
    await press("Registrar devolución");
    await setValue('[aria-label="Revendibles de Cargador USB-C"]', "4");
    await evaluate(`(()=>{const t=document.querySelector('#return-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Cliente devolvió');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await click(`${panel}.querySelector('[data-detail-return]')`, "Registrar devolución");
    await waitText("Cargador USB-C: como máximo 3 pendientes.");
    assert.equal(count(`/api/sales/${delivered.id}/returns`), 0, "client cap: nothing sent");
    await setValue('[aria-label="Revendibles de Cargador USB-C"]', "1");
    await setValue('[aria-label="Dañadas de Cargador USB-C"]', "1");
    const stockBefore = items[0].stock;
    await click(`${panel}.querySelector('[data-detail-return]')`, "Registrar devolución");
    await waitText("Devolución registrada.");
    await synced(delivered);
    assert.equal(items[0].stock, stockBefore + 1, "only the resellable unit returns to stock");
    await waitFor(`${row(delivered.id)}?.querySelector('[data-sale-status="PARTIALLY_RETURNED"]')`, "devuelta parcialmente en la lista");
    assert.ok((await evaluate(`${panel}.innerText`)).includes("Devueltas 2 de 3"));
    await press("Registrar devolución");
    await setValue('[aria-label="Revendibles de Cargador USB-C"]', "1");
    await setValue('[aria-label="Revendibles de Funda"]', "1");
    await evaluate(`(()=>{const t=document.querySelector('#return-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Devuelve el resto');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    force409 = "RETURN_EXCEEDS_SOLD";
    await click(`${panel}.querySelector('[data-detail-return]')`, "Registrar devolución");
    await waitText("Devolverías más de lo pendiente");
    await press("Recargar la venta");
    await click(`${panel}.querySelector('[data-detail-return]')`, "Registrar devolución");
    await waitFor(`${panel}.querySelector('[data-sale-status="RETURNED"]')`, "devuelta");
    const history = await evaluate(`${panel}.innerText.replace(/\\s+/g,' ')`);
    for (const part of ["Devolución 1", "Motivo: Cliente devolvió", "Devolución 2", "Motivo: Devuelve el resto", "Esta venta ya no tiene acciones pendientes."]) assert.ok(history.includes(part), part);
    assert.equal(delivered.status, "RETURNED");
    assert.ok(mutations.filter(m => m.path.endsWith("/returns")).every(m => !("refundNow" in m.body)), "LEGACY returns move no money");
    checks.push("Partial return: capped on screen at the pending units, resellable back to stock, «Devuelta parcialmente»; 409 RETURN_EXCEEDS_SOLD explained with reload; the rest → RETURNED with both returns and reasons, no actions left");

    // Cancel with a mandatory reason: units back to stock, read-only afterwards.
    await open(toCancel);
    await press("Cancelar venta");
    await click(`${panel}.querySelector('[data-detail-cancel]')`, "Sí, cancelar");
    await waitText("Escribe un motivo de 3 a 300 caracteres.");
    assert.equal(count(`/api/sales/${toCancel.id}/cancel`), 0);
    await evaluate(`(()=>{const t=document.querySelector('#cancel-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Cliente desistió');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const before = items[0].stock;
    await doublePress(`${panel}.querySelector('[data-detail-cancel]')`, "cancelar dos veces");
    await waitText("Venta cancelada. Las unidades volvieron al inventario.");
    assert.equal(count(`/api/sales/${toCancel.id}/cancel`), 1, "double click sends once");
    assert.equal(items[0].stock, before + 2);
    await synced(toCancel);
    assert.ok((await evaluate(`${panel}.innerText`)).includes("Esta venta ya no tiene acciones pendientes."));
    checks.push("Cancel: mandatory reason (nothing sent without it), a double click sends once, units back to stock, CANCELLED read-only");

    // Deliver a LEGACY confirmed sale (no payments sent); lost reply → «Reintentar» with the same operation.
    await open(toDeliver);
    await press("Entregar");
    dropNextAfterCommit = true;
    await click(`${panel}.querySelector('[data-detail-deliver]')`, "Sí, entregar");
    await waitText("Reintenta: se enviará la misma operación y no se duplicará.");
    await press("Reintentar");
    await waitText("Venta entregada.");
    const [lost, retried] = mutations.filter(m => m.path === `/api/sales/${toDeliver.id}/deliver`);
    assert.equal(lost.body.operationId, retried.body.operationId); assert.notEqual(lost.body.requestId, retried.body.requestId);
    assert.deepEqual(Object.keys(lost.body).sort(), ["expectedVersion", "operationId", "requestId"], "LEGACY delivery sends no payments");
    await synced(toDeliver);
    assert.equal(await evaluate(`Boolean(${button("Cancelar venta")})`), false, "no cancel once delivered");
    checks.push("Deliver a LEGACY sale: no payment fields; lost reply → «Reintentar» with the same operationId and a new requestId; once delivered there is no «Cancelar venta»");

    // 409 INVALID_TRANSITION (delivered elsewhere): reload shows the delivered sale and its return form.
    await open(conflict);
    await press("Entregar");
    Object.assign(conflict, { status: "DELIVERED", deliveredAt: stamp(), version: conflict.version + 1 });
    await click(`${panel}.querySelector('[data-detail-deliver]')`, "Sí, entregar");
    await waitText("Esa acción ya no está disponible");
    await press("Recargar la venta");
    await synced(conflict);
    assert.equal(await evaluate(`Boolean(${button("Registrar devolución")})`), true);
    checks.push("409 INVALID_TRANSITION: Spanish message; «Recargar la venta» shows the delivered sale with «Registrar devolución»");

    // A draft continues in Nueva venta.
    await open(draft);
    assert.equal(await evaluate(`${button("Continuar en Vender")}?.getAttribute('href')`), `/dashboard/ventas?borrador=${draft.id}`);
    checks.push("A draft is not edited here: «Continuar en Vender» opens it in Nueva venta");

    // Widths: no horizontal overflow with the detail open.
    for (const width of [320, 390, 1024, 1132, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.ok(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), `overflow at ${width}`);
      await shot("historial", width);
    }
    checks.push("Responsive: no horizontal overflow at 320, 390, 1024, 1132 and 1440 px with the detail open");
    assert.deepEqual(unknown, []);
  });
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message.slice(0, 2500) : String(error), checks }, null, 2));
  process.exitCode = 1;
}
