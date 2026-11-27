import assert from "node:assert/strict";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Vender › Historial, filter by customer (F2a-3b): the former «Ventas vinculadas a un cliente». Real Chromium, real
// Next proxy, simulated API. Only GET requests: GET /customers (search, all statuses), GET /customers/:id/sales
// (status and cursor pages) and GET /sales/:id to complete each row; the historical buyer is the sale's snapshot.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = { id: id(1), fullName: "Cliente actual", archivedAt: null };
const archived = { id: id(2), fullName: "Cliente archivado", archivedAt: "2026-11-23T00:00:00Z" };
const sale = (n, status = "CANCELLED") => ({ id: id(n), status, version: 2, currency: "COP", total: "9007199254740993", createdAt: new Date(Date.parse("2026-11-23T12:00:00Z") - n * 60000).toISOString(),
  sourceOrderId: null, customerNameSnapshot: "Comprador original", customerName: null });
let mode = "NORMAL", detailMode = "NORMAL", searchMode = "NORMAL", release;
const requests = [], unknown = [], checks = [];
const statusOf = n => (globalThis.statuses ?? {})[n] ?? "CANCELLED";
function fullSale(n) {
  const base = sale(n, statusOf(n));
  return { ...base, subtotal: "9007199254740993", discountTotal: "0", confirmedAt: base.createdAt, deliveredAt: null, cancelledAt: base.createdAt, returnedAt: null, customerId: customer.id,
    customerPhoneSnapshot: "3000000000", customerEmailSnapshot: "original@example.invalid", customerPhone: null, paymentMode: "LEGACY", payments: { mode: "LEGACY" },
    customer: { id: customer.id, fullName: "Nombre actual NO histórico", phone: "3110000000", email: "changed@example.invalid", archivedAt: null },
    lines: [{ id: id(500 + n), inventoryItemId: id(700), itemName: "Producto histórico", sku: "OLD", quantity: 3, unitPrice: "3002399751580331", unitDiscount: "0", lineTotal: "9007199254740993", unitCost: null }], returns: [] };
}
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  requests.push({ method: req.method, path: url.pathname });
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "GET") { unknown.push(req.method); return reply({}, 405); }
  if (url.pathname === "/api/me") return reply({ user: { emailVerifiedAt: "2026-11-23T00:00:00Z", hasLocalPassword: true } });
  if (url.pathname === "/api/sales") return reply({ result: [] });
  if (url.pathname === "/api/customers") {
    if (searchMode === "ERROR") return reply({ message: "Error de búsqueda" }, 503);
    if (searchMode === "INVALID") return reply({});
    assert.equal(url.searchParams.get("status"), "all", "archived customers are searchable");
    const page = Number(url.searchParams.get("page") ?? "1");
    return reply({ success: true, customers: searchMode === "EMPTY" || page > 1 ? [] : [customer, archived], hasMore: searchMode === "PAGED" && page === 1, page, pageSize: 25 });
  }
  if (/\/api\/customers\/[^/]+\/sales$/.test(url.pathname)) {
    const selected = url.pathname.includes(archived.id) ? archived : customer;
    const localMode = mode;
    if (localMode === "HOLD") await new Promise(resolve => { release = resolve; });
    if (localMode === "ERROR") return reply({ message: "Error temporal de red" }, 503);
    if (localMode === "NOT_FOUND") return reply({ error: "CUSTOMER_SALES_NOT_FOUND", message: "Cliente o página de ventas no disponible." }, 404);
    if (localMode === "SESSION") return reply({ message: "Sesión requerida" }, 401);
    if (localMode === "INVALID") return reply({ success: true, customer: selected, sales: null });
    const status = url.searchParams.get("status"), cursor = url.searchParams.get("cursor");
    if (localMode === "EMPTY") return reply({ success: true, customer: selected, sales: [], nextCursor: null });
    if (localMode === "PAGED") {
      if (cursor && cursor !== id(124)) return reply({ error: "CUSTOMER_SALES_NOT_FOUND", message: "Cursor no disponible." }, 404);
      const rows = Array.from({ length: cursor ? 2 : 25 }, (_, i) => sale((cursor ? 125 : 100) + i, status === "all" ? "CANCELLED" : status));
      return reply({ success: true, customer: selected, sales: rows, nextCursor: cursor ? null : id(124) });
    }
    const rows = [sale(100, status === "all" ? "CANCELLED" : status), sale(101, status === "all" ? "CANCELLED" : status)];
    globalThis.statuses = { 100: rows[0].status, 101: rows[1].status };
    return reply({ success: true, customer: selected, sales: rows, nextCursor: null });
  }
  const one = url.pathname.match(/^\/api\/sales\/([^/]+)$/);
  if (one) {
    if (detailMode === "MISSING") return reply({ error: "NOT_FOUND", message: "Venta no encontrada." }, 404);
    if (detailMode === "INVALID") return reply({ result: {} });
    return reply({ result: fullSale(Number(one[1].slice(-12))) });
  }
  unknown.push(url.pathname); return reply({}, 404);
}
try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const text = () => evaluate(`document.querySelector('main')?.innerText.replace(/\\s+/g,' ') ?? ''`);
    const waitFor = async (expression, label) => { try { await poll(() => evaluate(`Boolean(${expression})`)); } catch { throw new Error(`No se cumplió: ${label}\n--- pantalla ---\n${(await text()).slice(-1500)}`); } };
    const waitText = value => waitFor(`document.querySelector('main')?.innerText.replace(/\\s+/g," ").includes(${JSON.stringify(value)})`, value);
    const byText = label => `[...document.querySelectorAll('main button')].find(b=>(b.getAttribute('aria-label')??b.textContent).replace(/\\s+/g," ").trim()===${JSON.stringify(label)})`;
    const click = async label => { await waitFor(`(()=>{const b=${byText(label)};return b&&!b.disabled})()`, `botón ${label}`); await evaluate(`${byText(label)}.click()`); };
    const rows = () => evaluate(`document.querySelectorAll('[data-sale-row]').length`);
    const search = async () => click("Buscar clientes");
    const choose = async who => { await waitFor(`[...document.querySelectorAll('[aria-label="Clientes encontrados"] button')].some(b=>b.textContent.includes(${JSON.stringify(who.fullName)}))`, "resultados");
      await evaluate(`[...document.querySelectorAll('[aria-label="Clientes encontrados"] button')].find(b=>b.textContent.includes(${JSON.stringify(who.fullName)})).click()`); };
    const clearCustomer = async who => click(`Quitar el filtro de ${who.fullName}`);
    const setStatus = value => evaluate(`(()=>{const s=document.querySelector('#history-status');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);

    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/ventas/historial" });
    await waitText("Aún no hay ventas.");
    assert.equal(requests.some(r => r.path.endsWith("/sales") && r.path.includes("/customers/")), false, "nothing is queried until a customer is chosen");
    await search(); await choose(customer);
    await waitText("Ventas de Cliente actual"); await waitText("Comprador original");
    assert.equal(await rows(), 2);
    const shown = await text();
    assert.ok(shown.includes("Cancelada") && shown.includes("$ 9.007.199.254.740.993") && shown.includes("sin registro de pagos"), "status, exact BigInt total, LEGACY tag");
    assert.ok(!shown.includes("Nombre actual NO histórico"), "the row shows the historical buyer");
    assert.ok(shown.includes("Solo aparecen las ventas vinculadas a este cliente."));
    checks.push("Customer filter: search (all statuses), choose → GET /customers/:id/sales; rows with the historical buyer, status, exact BigInt total and «sin registro de pagos»; nothing queried before choosing");

    await evaluate(`document.querySelector('[data-sale-row="${id(100)}"]').click()`);
    await waitFor(`document.querySelector('[data-sale-detail="${id(100)}"]')`, "detalle");
    const detail = await evaluate(`document.querySelector('[data-detail-panel]').innerText.replace(/\\s+/g,' ')`);
    for (const part of ["Producto histórico", "3 × $ 3.002.399.751.580.331", "$ 9.007.199.254.740.993", "Comprador original"]) assert.ok(detail.includes(part), part);
    for (const absent of ["Nombre actual NO histórico", "changed@example.invalid"]) assert.ok(!detail.includes(absent), absent);
    await evaluate(`document.querySelector('[aria-label="Cerrar detalle"]').click()`);
    checks.push("Detail of a customer's sale: the lines and exact prices saved in the sale and the historical buyer, never the customer's current name or email");

    mode = "PAGED"; await setStatus("all");
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===25`, "25 ventas");
    await click("Más ventas de este cliente");
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===27`, "27 ventas");
    assert.equal(new Set(await evaluate(`[...document.querySelectorAll('[data-sale-row]')].map(b=>b.dataset.saleRow)`)).size, 27, "distinct sales");
    assert.equal(await evaluate(`Boolean(${byText("Más ventas de este cliente")})`), false, "last page");
    await clearCustomer(customer); await search(); await choose(archived);
    await waitText("Cliente: Cliente archivado · Archivado");
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===25`, "ventas del archivado");
    checks.push("27 distinct sales across cursor pages («Más ventas de este cliente»), then an archived customer with linked sales");

    mode = "NORMAL"; await clearCustomer(archived); await search(); await choose(customer);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===2`, "2 ventas");
    for (const [value, expected] of [["ERROR", "Error temporal de red"], ["INVALID", "La respuesta de ventas no es válida"], ["NOT_FOUND", "Cliente o página"], ["SESSION", "Tu sesión expiró"]]) {
      mode = value; await setStatus("CANCELLED"); await waitText(expected);
      mode = "NORMAL"; await click("Reintentar"); await waitFor(`document.querySelectorAll('[data-sale-row]').length===2`, `reintento tras ${value}`);
      await setStatus("all"); await waitFor(`document.querySelectorAll('[data-sale-row]').length===2`, "todas");
    }
    checks.push("Network error, malformed response, unavailable customer or cursor and expired session: Spanish message and «Reintentar»");

    await command("Network.setBlockedURLs", { urls: ["*localhost:4338/api/backend/customers/*/sales*"] });
    await setStatus("CANCELLED"); await waitText("No se pudo conectar con la API");
    await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*"] });
    await click("Reintentar"); await waitFor(`document.querySelectorAll('[data-sale-row]').length===2`, "reintento tras corte");
    checks.push("Actual browser network failure and explicit retry");

    detailMode = "MISSING"; await setStatus("all"); await waitText("Venta no encontrada.");
    detailMode = "INVALID"; await click("Reintentar"); await waitText("La respuesta de ventas no es válida");
    detailMode = "NORMAL"; await click("Reintentar"); await waitFor(`document.querySelectorAll('[data-sale-row]').length===2`, "detalle recuperado");
    checks.push("A row that cannot be read (missing or invalid sale) is explained and recovered with «Reintentar»");

    mode = "HOLD"; await setStatus("CANCELLED"); await waitText("Cargando ventas"); await poll(() => Boolean(release));
    await clearCustomer(customer); mode = "EMPTY"; await search(); await choose(archived);
    await waitText("Este cliente no tiene ventas vinculadas.");
    release(); await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(!(await text()).includes("Comprador original"), "late reply of the previous customer discarded");
    checks.push("Archived customer with an empty history; the late reply for the previous customer is discarded");

    mode = "NORMAL"; await clearCustomer(archived); await search(); await choose(customer);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===2`, "2 ventas");
    await setStatus("RETURNED");
    await waitFor(`document.querySelectorAll('[data-sale-row] [data-sale-status="RETURNED"]').length===2`, "devueltas");
    assert.ok(requests.some(r => r.path === `/api/customers/${customer.id}/sales`), "status sent to the API");
    checks.push("The status filter queries the customer's sales again with that status");

    await clearCustomer(customer);
    searchMode = "ERROR"; await search(); await waitText("Error de búsqueda");
    searchMode = "INVALID"; await click("Reintentar búsqueda"); await waitText("La respuesta de ventas no es válida");
    searchMode = "EMPTY"; await click("Reintentar búsqueda"); await waitText("No se encontraron clientes");
    searchMode = "NORMAL"; await search(); await waitFor(`document.querySelector('[aria-label="Clientes encontrados"] button')`, "clientes");
    await fill("#history-customer-q", "Otro nombre");
    assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Clientes encontrados"]'))`), false, "typing invalidates the results");
    checks.push("Search errors, malformed and empty responses, retry and input invalidation");

    searchMode = "PAGED"; await search(); await waitFor(`${byText("Más clientes")}`, "más clientes");
    await click("Más clientes"); await waitText("No se encontraron clientes en esta página");
    await click("Clientes anteriores"); await waitFor(`document.querySelector('[aria-label="Clientes encontrados"] button')?.textContent.includes('Cliente actual')`, "página 1");
    await evaluate(`document.querySelector('#history-customer-q').focus()`);
    for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor(`document.querySelector('[aria-label="Clientes encontrados"] button')`, "búsqueda con Enter");
    checks.push("Customer pagination, empty out-of-range page and keyboard search (Enter)");

    assert.ok(requests.every(r => r.method === "GET"), "read-only"); assert.deepEqual(unknown, []);
  }, { browser: "chrome", sandbox: false });
  console.log(JSON.stringify({ success: true, checks, requests: requests.length, writes: 0 }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message.slice(0, 2500) : String(error), checks }, null, 2));
  process.exitCode = 1;
}
