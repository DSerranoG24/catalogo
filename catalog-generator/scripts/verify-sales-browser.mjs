import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Real Chromium, real Next proxy, simulated API with the sales rules of contract v2.1.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();
const items = [
  { id: randomUUID(), name: "Cargador USB-C", sku: "CARG-1", stock: 5, terms: { unitSalePrice: 45000n, version: 1 } },
  { id: randomUUID(), name: "Funda", sku: "FUN-1", stock: 1, terms: { unitSalePrice: 20000n, version: 1 } },
  { id: randomUUID(), name: "Vidrio templado", sku: "VID-1", stock: 9, terms: null },
];
const customer = { id: randomUUID(), fullName: "Ana Prueba", phone: "3000000000", email: null, archivedAt: null };
const sales = new Map(), operations = new Map(), mutations = [], unknown = [], checks = [];
let dropNextAfterCommit = false, force409 = null;
const item = sku => items.find(i => i.sku === sku);
const json = v => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);
const view = sale => ({ ...sale, lines: sale.lines, returns: sale.returns, customer: sale.customerId ? customer : null });
const withoutKeys = body => Object.fromEntries(Object.entries(body).filter(([key]) => key !== "operationId" && key !== "requestId"));
class Fail extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

function replayOrRecord(body, action, saleId, work) {
  const operationId = body.operationId, content = withoutKeys(body);
  if (!uuid.test(operationId ?? "")) throw new Fail(400, "INVALID_SALE_INPUT");
  const hash = JSON.stringify({ action, saleId, content });
  const previous = operations.get(operationId);
  if (previous) { if (previous.hash !== hash) throw new Fail(409, "IDEMPOTENCY_CONFLICT"); return previous.response; }
  const response = work();
  operations.set(operationId, { hash, response });
  return response;
}
function totals(sale) {
  sale.subtotal = sale.lines.reduce((s, l) => s + BigInt(l.unitPrice) * BigInt(l.quantity), 0n);
  sale.discountTotal = sale.lines.reduce((s, l) => s + BigInt(l.unitDiscount) * BigInt(l.quantity), 0n);
  sale.total = sale.subtotal - sale.discountTotal;
}
function mutate(method, path, body) {
  let m;
  if (method === "POST" && path === "/api/sales") {
    if (!uuid.test(body.requestId ?? "")) throw new Fail(400, "INVALID_SALE_INPUT");
    return replayOrRecord(body, "create", "new", () => {
      const sale = { id: randomUUID(), status: "DRAFT", version: 1, currency: "COP", subtotal: 0n, discountTotal: 0n, total: 0n, createdAt: now(), updatedAt: now(),
        confirmedAt: null, deliveredAt: null, cancelledAt: null, returnedAt: null, customerId: body.customerId ?? null,
        customerNameSnapshot: body.customerId ? customer.fullName : null, customerPhoneSnapshot: body.customerId ? customer.phone : null, customerEmailSnapshot: null,
        customerName: null, customerPhone: null, sourceOrderId: null, lines: [], returns: [] };
      sales.set(sale.id, sale); return { result: view(sale) };
    });
  }
  if ((m = path.match(/^\/api\/sales\/([^/]+)(?:\/(confirm|deliver|cancel|returns))?$/))) {
    const sale = sales.get(m[1]); if (!sale) throw new Fail(404, "NOT_FOUND");
    const action = m[2] ?? "patch";
    if (action === "patch") {
      if ("requestId" in body) throw new Fail(400, "INVALID_SALE_INPUT"); // PATCH schema is strict.
      const previous = operations.get(body.operationId);
      if (previous) { if (previous.hash !== JSON.stringify({ action, saleId: sale.id, content: withoutKeys(body) })) throw new Fail(409, "IDEMPOTENCY_CONFLICT"); return { result: view(sale) }; }
      if (sale.status !== "DRAFT") throw new Fail(409, "INVALID_TRANSITION");
      if (sale.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
      return replayOrRecord(body, action, sale.id, () => {
        sale.lines = body.lines.map(l => {
          const it = items.find(i => i.id === l.inventoryItemId); if (!it) throw new Fail(400, "ITEM_NOT_FOUND"); if (!it.terms) throw new Fail(400, "PRICE_REQUIRED");
          if (BigInt(l.unitDiscount) > it.terms.unitSalePrice) throw new Fail(400, "INVALID_DISCOUNT");
          return { id: randomUUID(), saleId: sale.id, inventoryItemId: it.id, quantity: l.quantity, itemName: it.name, sku: it.sku, unitPrice: it.terms.unitSalePrice, unitCost: null,
            unitDiscount: BigInt(l.unitDiscount), lineTotal: (it.terms.unitSalePrice - BigInt(l.unitDiscount)) * BigInt(l.quantity), commercialTermsVersion: it.terms.version };
        });
        if ("customerId" in body) { sale.customerId = body.customerId; sale.customerNameSnapshot = body.customerId ? customer.fullName : null; }
        totals(sale); sale.version++; return { result: view(sale) };
      });
    }
    if (!uuid.test(body.requestId ?? "")) throw new Fail(400, "INVALID_SALE_INPUT");
    const previous = operations.get(body.operationId);
    if (!previous && force409) { const code = force409; force409 = null; throw new Fail(409, code); }
    return replayOrRecord(body, action, sale.id, () => {
      if (action === "confirm") {
        if (sale.status !== "DRAFT" || sale.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
        for (const l of sale.lines) { const it = items.find(i => i.id === l.inventoryItemId); if (it.stock < l.quantity) throw new Fail(409, "STOCK_INSUFFICIENT"); if (it.terms.version !== l.commercialTermsVersion) throw new Fail(409, "PRICE_CHANGED"); }
        for (const l of sale.lines) items.find(i => i.id === l.inventoryItemId).stock -= l.quantity;
        Object.assign(sale, { status: body.deliverImmediately ? "DELIVERED" : "CONFIRMED", confirmedAt: now(), deliveredAt: body.deliverImmediately ? now() : null });
      } else if (action === "deliver") {
        if (sale.status !== "CONFIRMED" || sale.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
        Object.assign(sale, { status: "DELIVERED", deliveredAt: now() });
      } else if (action === "cancel") {
        if (sale.status !== "CONFIRMED" || sale.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
        if (!body.reason || body.reason.length < 3) throw new Fail(400, "INVALID_SALE_INPUT");
        for (const l of sale.lines) items.find(i => i.id === l.inventoryItemId).stock += l.quantity;
        Object.assign(sale, { status: "CANCELLED", cancelledAt: now() });
      } else {
        if (sale.status !== "DELIVERED" || sale.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
        const returned = id => sale.returns.flatMap(r => r.lines).filter(l => l.saleLineId === id).reduce((s, l) => s + l.receivedQuantity, 0);
        for (const l of body.lines) { const line = sale.lines.find(x => x.id === l.saleLineId); if (!line) throw new Fail(400, "RETURN_LINE_NOT_FOUND"); if (returned(line.id) + l.receivedQuantity > line.quantity) throw new Fail(409, "RETURN_EXCEEDS_SOLD"); if (l.resellableQuantity + l.damagedQuantity !== l.receivedQuantity) throw new Fail(400, "INVALID_SALE_INPUT"); }
        for (const l of body.lines) if (l.resellableQuantity) items.find(i => i.id === sale.lines.find(x => x.id === l.saleLineId).inventoryItemId).stock += l.resellableQuantity;
        sale.returns.push({ id: randomUUID(), saleId: sale.id, reason: body.reason, createdAt: now(), operationId: body.operationId, lines: body.lines.map(l => ({ id: randomUUID(), ...l })) });
        if (sale.lines.every(l => returned(l.id) === l.quantity)) Object.assign(sale, { status: "RETURNED", returnedAt: now() });
      }
      sale.version++; return { result: { ...view(sale), customer: undefined } };
    });
  }
  return null;
}

async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(json(body)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  if (req.method === "GET") {
    if (url.pathname === "/api/me") return reply({ user: { emailVerifiedAt: now(), hasLocalPassword: true } });
    if (url.pathname === "/api/sales") return reply({ result: [...sales.values()].toReversed().map(view) });
    const one = url.pathname.match(/^\/api\/sales\/([^/]+)$/);
    if (one) { const sale = sales.get(one[1]); return sale ? reply({ result: view(sale) }) : reply({ error: "NOT_FOUND", message: "NOT_FOUND" }, 404); }
    if (url.pathname === "/api/inventory/items") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const found = items.filter(i => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
      return reply({ success: true, result: { items: found.map(i => ({ id: i.id, name: i.name, sku: i.sku, stock: i.stock, minimumStock: 0, dataVersion: 1, stockVersion: 1,
        commercialTerms: i.terms ? { unitSalePrice: i.terms.unitSalePrice, referenceUnitCost: null, currency: "COP", version: i.terms.version } : null })), total: found.length, page: 1 } });
    }
    if (url.pathname === "/api/customers") return reply({ success: true, customers: [customer], hasMore: false, page: 1, pageSize: 25 });
    unknown.push(`GET ${url.pathname}`); return reply({}, 404);
  }
  const body = raw ? JSON.parse(raw) : {};
  mutations.push({ method: req.method, path: url.pathname, body });
  try {
    const result = mutate(req.method, url.pathname, body);
    if (!result) { unknown.push(`${req.method} ${url.pathname}`); return reply({}, 404); }
    if (dropNextAfterCommit) { dropNextAfterCommit = false; req.socket.destroy(); return; } // committed, reply lost
    return reply(result, url.pathname === "/api/sales" && req.method === "POST" ? 201 : 200);
  } catch (error) {
    if (error instanceof Fail) return reply({ error: error.code, message: error.code }, error.status);
    throw error;
  }
}

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const text = () => evaluate("document.body.innerText");
    const waitText = async value => { try { await poll(async () => (await text()).includes(value)); } catch { throw new Error(`Texto no encontrado: ${value}
--- pantalla ---
${(await text()).slice(0, 1500)}`); } };
    // Waits until the detail shows the server's current version of the sale.
    const synced = () => poll(() => evaluate(`document.querySelector('[data-sale-id="${current().id}"]')?.dataset.saleVersion === "${current().version}"`));
    const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
    const click = async label => assert.equal(await evaluate(`(()=>{const b=${button(label)};if(!b||b.disabled)return false;b.click();return true})()`), true, `click ${label}`);
    const doubleClick = async label => assert.equal(await evaluate(`(()=>{const b=${button(label)};if(!b||b.disabled)return false;b.click();b.click();return true})()`), true, `double click ${label}`);
    const disabled = label => evaluate(`(()=>{const b=${button(label)};return b?b.disabled:null})()`);
    const exists = label => evaluate(`Boolean(${button(label)})`);
    const setValue = (selector, value) => fill(selector, value);
    const count = (path, method = "POST") => mutations.filter(m => m.method === method && m.path === path).length;
    const current = () => [...sales.values()].at(-1);
    const stock = sku => item(sku).stock;
    // Optional review screenshots: SALES_SCREENSHOTS=<folder outside the repo>.
    const shot = async (name, width = 1440) => {
      const folder = process.env.SALES_SCREENSHOTS; if (!folder) return;
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise(resolve => setTimeout(resolve, 300));
      const { data } = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(path.join(folder, `${name}-${width}.png`), Buffer.from(data, "base64"));
      await command("Emulation.clearDeviceMetricsOverride");
    };

    await command("Page.navigate", { url: "http://localhost:4338/dashboard/ventas" });
    await waitText("Aún no hay ventas");
    assert.equal(await evaluate(`document.querySelector('header a[href="/dashboard/ventas"]')?.getAttribute('aria-current')`), "page");
    assert.ok((await text()).includes("Los totales no indican pagos recibidos."));
    assert.deepEqual(mutations, [], "opening the panel writes nothing");
    await shot("01-listado-vacio");
    checks.push("Header link Ventas (aria-current), empty list, payments notice and no writes on load");

    // Draft: create (double click), search inventory, price/stock/no-terms, lines, estimate, save.
    await doubleClick("Crear borrador de venta"); await waitText("Editar borrador");
    assert.equal(count("/api/sales"), 1, "double click creates one draft");
    await click("Buscar artículos"); await waitText("Cargador USB-C");
    assert.ok((await text()).includes("Sin ficha comercial: configura el precio en Inventario"));
    assert.equal(await disabled("Añadir Vidrio templado"), true, "an item without commercial terms cannot be added");
    assert.ok((await text()).includes("$ 45.000") && (await text()).includes("5 en stock"));
    await click("Añadir Cargador USB-C"); await click("Añadir Funda");
    await setValue('input[aria-label="Cantidad de Cargador USB-C"]', "3");
    await setValue('input[aria-label="Descuento unitario de Cargador USB-C"]', "5000");
    await waitText("Total $ 140.000");
    assert.equal(await disabled("Confirmar"), true, "unsaved changes block confirmation");
    await setValue('input[aria-label="Descuento unitario de Cargador USB-C"]', "50000");
    await click("Guardar borrador"); await waitText("supera su precio");
    assert.equal(count(`/api/sales/${current().id}`, "PATCH"), 0, "client validation blocks the request");
    await setValue('input[aria-label="Descuento unitario de Cargador USB-C"]', "5000");
    await doubleClick("Guardar borrador"); await waitText("Borrador guardado"); await synced();
    assert.equal(count(`/api/sales/${current().id}`, "PATCH"), 1, "double click saves once");
    assert.ok(mutations.filter(m => m.method === "PATCH").every(m => !("requestId" in m.body) && uuid.test(m.body.operationId)));
    await shot("02-borrador"); await shot("02-borrador", 390);
    checks.push("Draft: double-click create/save once, inventory search with price, stock and no-terms warning, BigInt estimate, client validation");

    // 409 PRICE_CHANGED → reload draft with current prices.
    item("CARG-1").terms = { unitSalePrice: 50000n, version: 2 };
    await click("Confirmar"); await click("Sí, confirmar"); await waitText("El precio de un artículo cambió");
    await click("Recargar borrador con precios actuales"); await waitText("Borrador recargado con los precios actuales"); await synced();
    await waitText("Total $ 155.000");
    checks.push("409 PRICE_CHANGED: Spanish message and reload of the draft at current prices");

    // 409 VERSION_CONFLICT → reload the sale.
    current().version++;
    await click("Confirmar"); await click("Sí, confirmar"); await waitText("La venta cambió");
    await click("Recargar venta"); await synced();
    checks.push("409 VERSION_CONFLICT: reload the sale");

    // 409 STOCK_INSUFFICIENT names the item.
    item("FUN-1").stock = 0;
    await click("Confirmar"); await click("Sí, confirmar"); await waitText("No hay existencias suficientes");
    await waitText("Funda (SKU FUN-1): 0 disponibles, la venta pide 1.");
    await shot("03-error-stock");
    item("FUN-1").stock = 1; await click("Recargar venta"); await synced();
    checks.push("409 STOCK_INSUFFICIENT: names the item, its stock and the requested quantity");

    // Network failure after commit: Reintentar reuses the operationId with a new requestId; stock moves once.
    dropNextAfterCommit = true;
    await click("Confirmar"); await click("Sí, confirmar"); await waitText("Reintentar");
    assert.equal(current().status, "CONFIRMED", "the server committed before the reply was lost");
    await click("Reintentar"); await waitText("Venta confirmada."); await synced();
    const confirms = mutations.filter(m => m.path === `/api/sales/${current().id}/confirm`).slice(-2);
    assert.equal(confirms[0].body.operationId, confirms[1].body.operationId, "retry keeps the operationId");
    assert.notEqual(confirms[0].body.requestId, confirms[1].body.requestId, "retry sends a new requestId");
    assert.equal(stock("CARG-1"), 2); assert.equal(stock("FUN-1"), 0);
    await waitText("Confirmada");
    checks.push("Lost reply after commit: Reintentar with the same operationId and a new requestId, stock discounted once");

    // Browser offline: nothing reaches the server; Reintentar after reconnecting.
    await command("Network.setBlockedURLs", { urls: ["*localhost:4338/api/backend/sales/*/deliver*", "*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*"] });
    await click("Entregar"); await doubleClick("Sí, entregar"); await waitText("Reintentar");
    assert.equal(count(`/api/sales/${current().id}/deliver`), 0);
    await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*"] });
    await click("Reintentar"); await waitText("Venta entregada."); await synced();
    assert.equal(count(`/api/sales/${current().id}/deliver`), 1, "one delivery request after the retry");
    assert.equal(await exists("Cancelar venta"), false, "a delivered sale offers no cancellation");
    checks.push("Browser network failure on deliver, double click, retry, and no cancel action once delivered");

    // Partial return → client cap → forced RETURN_EXCEEDS_SOLD → return the rest → RETURNED read-only.
    const sale1 = current();
    await setValue('input[aria-label="Revendibles de Cargador USB-C"]', "1");
    await fill('section[aria-labelledby^="return-"] textarea', "Cliente cambió de opinión");
    await click("Registrar devolución"); await click("Sí, registrar devolución"); await waitText("Devolución registrada."); await synced();
    await waitText("Devuelta parcialmente"); await waitText("Vendida 3 · Devuelta 1 · Pendiente 2"); await waitText("Devolución 1");
    assert.equal(stock("CARG-1"), 3);
    await shot("04-devuelta-parcialmente"); await shot("04-devuelta-parcialmente", 390);
    await setValue('input[aria-label="Revendibles de Cargador USB-C"]', "3");
    await fill('section[aria-labelledby^="return-"] textarea', "De más");
    await click("Registrar devolución"); await waitText("como máximo 2 pendientes");
    force409 = "RETURN_EXCEEDS_SOLD";
    await setValue('input[aria-label="Revendibles de Cargador USB-C"]', "1");
    await click("Registrar devolución"); await click("Sí, registrar devolución"); await waitText("Devolverías más de lo pendiente");
    await click("Recargar venta"); await synced();
    await setValue('input[aria-label="Revendibles de Cargador USB-C"]', "1");
    await setValue('input[aria-label="Dañadas de Cargador USB-C"]', "1");
    await setValue('input[aria-label="Dañadas de Funda"]', "1");
    await fill('section[aria-labelledby^="return-"] textarea', "Resto de la venta");
    await click("Registrar devolución"); await click("Sí, registrar devolución"); await waitText("Esta venta es de solo lectura.");
    assert.equal(sale1.status, "RETURNED"); assert.equal(sale1.returns.length, 2); assert.equal(stock("CARG-1"), 4); assert.equal(stock("FUN-1"), 0);
    assert.equal(await exists("Registrar devolución"), false);
    await waitText("Devolución 2"); await waitText("Motivo: Resto de la venta");
    await shot("05-devuelta-solo-lectura");
    checks.push("Partial return, client cap at pending units, 409 RETURN_EXCEEDS_SOLD, return of the rest, RETURNED read-only with history");

    // Second sale with a customer: confirm (double click in the dialog) and cancel with a mandatory reason.
    await fill('input[placeholder="Nombre o teléfono"]', "Ana");
    await click("Buscar clientes"); await poll(() => evaluate(`[...document.querySelectorAll('#new-sale-customer option')].length === 2`));
    await evaluate(`(()=>{const s=document.querySelector('#new-sale-customer');s.value=${JSON.stringify(customer.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await click("Crear borrador de venta"); await waitText("Editar borrador");
    const sale2 = current(); assert.equal(sale2.customerId, customer.id);
    await click("Buscar artículos"); await waitText("Añadir Cargador USB-C"); await click("Añadir Cargador USB-C");
    await click("Guardar borrador"); await waitText("Borrador guardado"); await synced();
    await click("Confirmar"); await doubleClick("Sí, confirmar"); await waitText("Venta confirmada."); await synced();
    assert.equal(count(`/api/sales/${sale2.id}/confirm`), 1, "double click in the dialog confirms once");
    assert.equal(stock("CARG-1"), 3);
    await click("Cancelar venta");
    assert.equal(await disabled("Sí, cancelar la venta"), true, "a reason is mandatory");
    await shot("06-dialogo-cancelar");
    await fill('[role="alertdialog"] textarea', "Cliente desistió");
    await click("Sí, cancelar la venta"); await waitText("Venta cancelada.");
    assert.equal(sale2.status, "CANCELLED"); assert.equal(stock("CARG-1"), 4);
    await waitText("Esta venta es de solo lectura.");
    checks.push("Customer chosen from search, confirm double click once, cancel with mandatory reason, CANCELLED read-only");

    // INVALID_TRANSITION: the sale was delivered elsewhere while this screen still showed it confirmed.
    await click("Crear borrador de venta"); await waitText("Editar borrador");
    const sale3 = current();
    await click("Buscar artículos"); await waitText("Añadir Cargador USB-C"); await click("Añadir Cargador USB-C");
    await click("Guardar borrador"); await waitText("Borrador guardado"); await synced();
    await click("Confirmar"); await click("Sí, confirmar"); await waitText("Venta confirmada."); await synced();
    Object.assign(sale3, { status: "DELIVERED", deliveredAt: now(), version: sale3.version + 1 });
    await click("Cancelar venta"); await fill('[role="alertdialog"] textarea', "Ya no aplica");
    await click("Sí, cancelar la venta"); await waitText("Esa acción ya no está disponible");
    await click("Recargar venta"); await synced(); await waitText("Registrar devolución");
    checks.push("409 INVALID_TRANSITION: reload shows the delivered sale and its return form");

    // List: labels, COP format, items count, filter and opening a sale.
    await click("Actualizar listado"); await waitText("Ventas registradas");
    const list = () => evaluate(`document.querySelector('ul[aria-label="Ventas"]').innerText`);
    await poll(async () => (await list()).includes("Cancelada") && (await list()).includes("Devuelta"));
    assert.ok((await list()).includes("$ 155.000") && (await list()).includes("4 artículos") && (await list()).includes("Ana Prueba"));
    await evaluate(`(()=>{const s=document.querySelector('#sales-filter');s.value='CANCELLED';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await poll(async () => (await list()).includes("Cancelada") && !(await list()).includes("Entregada") && !(await list()).includes("Devuelta"));
    await evaluate(`document.querySelector('ul[aria-label="Ventas"] button').click()`);
    await poll(() => evaluate(`document.activeElement?.tagName === 'H2' && document.activeElement.textContent.includes(${JSON.stringify(sale2.id.slice(0, 8))})`));
    await evaluate(`(()=>{const s=document.querySelector('#sales-filter');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await shot("07-listado-filtrado"); await shot("07-listado-filtrado", 320);
    checks.push("List with date, customer, items, COP totals and Spanish status labels; status filter; click opens the detail and focuses its heading");

    // Keyboard: Tab reaches the list buttons and the focused element shows an outline.
    await evaluate(`document.querySelector('#sales-filter').focus()`);
    for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate(`document.activeElement?.closest('ul[aria-label="Ventas"]') !== null`), true, "Tab moves from the filter to the first sale");
    assert.notEqual(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), "none", "visible focus");
    checks.push("Keyboard: Tab order from filter to sales list with visible focus");

    // Responsive: no horizontal overflow at 320, 390, 1024 and 1440 px with a draft editor open.
    await click("Crear borrador de venta"); await waitText("Editar borrador");
    await click("Buscar artículos"); await waitText("Añadir Cargador USB-C"); await click("Añadir Cargador USB-C");
    for (const width of [320, 390, 1024, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise(resolve => setTimeout(resolve, 250));
      const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      assert.ok(overflow <= 0, `horizontal overflow of ${overflow}px at ${width}px`);
    }
    await command("Emulation.clearDeviceMetricsOverride");
    checks.push("Responsive: no horizontal overflow at 320, 390, 1024 and 1440 px");

    // Every mutation: operationId UUID; requestId UUID except PATCH; no duplicated requestId.
    assert.ok(mutations.every(m => uuid.test(m.body.operationId)));
    assert.ok(mutations.filter(m => m.method === "POST").every(m => uuid.test(m.body.requestId)));
    const requestIds = mutations.filter(m => m.body.requestId).map(m => m.body.requestId);
    assert.equal(new Set(requestIds).size, requestIds.length, "a new requestId for every transmission");
    assert.ok(mutations.every(m => !/total|subtotal|unitPrice|lineTotal/.test(JSON.stringify(m.body))), "the client never sends prices or totals");
    assert.deepEqual(unknown, []);
    console.log(JSON.stringify({ checks, mutations: mutations.length, sales: sales.size, productionAccess: false, simulatedApi: true }, null, 2));
  }, { browser: "chrome", sandbox: false });
} catch (error) { console.error(error); process.exitCode = 1; }
