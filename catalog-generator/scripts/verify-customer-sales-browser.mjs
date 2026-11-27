import assert from "node:assert/strict";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = { id: id(1), fullName: "Cliente actual", archivedAt: null };
const archived = { id: id(2), fullName: "Cliente archivado", archivedAt: "2026-11-23T00:00:00Z" };
const sale = n => ({ id: id(n), status: "CANCELLED", version: 2, currency: "COP", total: "9007199254740993", createdAt: "2026-11-23T12:00:00Z", sourceOrderId: null, customerNameSnapshot: "Comprador original", customerName: null });
let mode = "NORMAL", detailMode = "NORMAL", searchMode = "NORMAL", release;
const requests = [], unknown = [], checks = [];
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  requests.push({ method: req.method, path: url.pathname });
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "GET") { unknown.push(req.method); return reply({}, 405); }
  if (url.pathname === "/api/me") return reply({ user: { emailVerifiedAt: "2026-11-23T00:00:00Z", hasLocalPassword: true } });
  if (url.pathname === "/api/sales") return reply({ result: [] });
  if (url.pathname === "/api/customers") {
    if (url.searchParams.get("status") === "active") return reply({ success: true, customers: [], hasMore: false, page: 1, pageSize: 25 }); // Existing create form.
    if (searchMode === "ERROR") return reply({ message: "Error de búsqueda" }, 503);
    if (searchMode === "INVALID") return reply({});
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
    const status = url.searchParams.get("status");
    if (localMode === "PAGED") {
      const cursor = url.searchParams.get("cursor");
      if (cursor && cursor !== id(124)) return reply({ error: "CUSTOMER_SALES_NOT_FOUND", message: "Cursor no disponible." }, 404);
      const rows = Array.from({ length: cursor ? 2 : 25 }, (_, i) => ({ ...sale((cursor ? 125 : 100) + i), status: status === "all" ? "CANCELLED" : status }));
      return reply({ success: true, customer: selected, sales: rows, nextCursor: cursor ? null : id(124) });
    }
    const rows = localMode === "EMPTY" || url.searchParams.has("cursor") ? [] : Array.from({ length: 25 }, (_, i) => ({ ...sale(100 + i), status: status === "all" ? "CANCELLED" : status }));
    return reply({ success: true, customer: selected, sales: rows, nextCursor: rows.length ? rows.at(-1).id : null });
  }
  if (/\/api\/sales\/[^/]+$/.test(url.pathname)) {
    if (detailMode === "MISSING") return reply({ error: "NOT_FOUND", message: "Venta no encontrada." }, 404);
    if (detailMode === "INVALID") return reply({ result: {} });
    return reply({ result: { ...sale(100), customerId: customer.id, customerPhoneSnapshot: detailMode === "OPTIONAL" ? null : "3000000000", customerEmailSnapshot: detailMode === "OPTIONAL" ? null : "original@example.invalid", customerPhone: null,
      customer: { fullName: "Nombre actual NO histórico", phone: "3110000000", email: "changed@example.invalid" }, lines: [
        { id: id(500), itemName: "Producto histórico", sku: "OLD", quantity: 3, unitPrice: "100", unitDiscount: "1", lineTotal: "297" },
        { id: id(501), itemName: "Segunda línea histórica", sku: "OLD-2", quantity: 2, unitPrice: "4503599627370348", unitDiscount: "0", lineTotal: "9007199254740696" },
      ] } });
  }
  unknown.push(url.pathname); return reply({}, 404);
}
try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const root = `document.querySelector('section[aria-label="Ventas vinculadas a un cliente"]')`;
    const text = () => evaluate(`${root}?.textContent ?? ''`);
    const click = async label => assert.equal(await evaluate(`(()=>{const b=[...${root}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`), true, label);
    const waitText = value => poll(async () => (await text()).includes(value));
    const choose = async value => evaluate(`(()=>{const s=${root}.querySelectorAll('select')[0];s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/ventas/historial" }); // F2a-3a: the previous Ventas view is Historial
    await poll(() => evaluate(`Boolean(${root})`));
    assert.equal(requests.some(r => r.path.endsWith("/sales") && r.path.includes("/customers/")), false);
    await click("Buscar clientes"); await waitText("Selecciona un cliente"); await choose(customer.id);
    await click("Consultar ventas"); await waitText("Comprador original");
    assert.ok((await text()).includes("Cancelada")); assert.ok((await text()).includes("9.007.199.254.740.993"));
    checks.push("Real sales route, explicit query, historical buyer, cancelled state and precise bigint");
    await click("Ver líneas de venta 00000000"); await waitText("Producto histórico");
    assert.ok((await text()).includes("Cantidad 3")); assert.ok(!(await text()).includes("Nombre actual NO histórico"));
    assert.ok((await text()).includes("Segunda línea histórica"));
    assert.ok((await text()).includes("3000000000")); assert.ok((await text()).includes("original@example.invalid"));
    assert.ok(!(await text()).includes("changed@example.invalid"));
    detailMode = "OPTIONAL"; await click("Ver líneas de venta 00000000"); await waitText("No registrado"); detailMode = "NORMAL";
    checks.push("Read-only multiline detail with original name, phone, email and exact prices/totals");
    await click("Siguiente página de ventas"); await waitText("No hay ventas vinculadas en esta página.");
    await click("Volver al inicio"); await waitText("Comprador original"); checks.push("Multiple sales and empty cursor page with return to start");
    mode = "PAGED"; await click("Consultar ventas"); await waitText("Comprador original");
    assert.equal(await evaluate(`${root}.querySelector('ul').children.length`), 25);
    await click("Siguiente página de ventas"); await waitText(id(125));
    assert.equal(await evaluate(`${root}.querySelector('ul').children.length`), 2);
    assert.ok(!(await text()).includes(id(100))); assert.ok((await text()).includes(id(126)));
    assert.equal(await evaluate(`[...${root}.querySelectorAll('button')].some(b=>b.textContent==='Siguiente página de ventas')`), false);
    await choose(archived.id); await click("Consultar ventas"); await waitText("Comprador original");
    assert.ok((await text()).includes("Cliente archivado · Archivado"));
    checks.push("27 distinct sales across cursor pages and archived customer with linked sales");
    await choose(customer.id); mode = "NORMAL"; await click("Consultar ventas"); await waitText("Comprador original");
    for (const [value, expected] of [["ERROR", "Error temporal de red"], ["INVALID", "La respuesta de ventas no es válida"], ["NOT_FOUND", "Cliente o página"], ["SESSION", "Tu sesión expiró"]]) {
      mode = value; await click("Consultar ventas"); await waitText(expected);
      mode = "NORMAL"; await click("Reintentar ventas"); await waitText("Comprador original");
    }
    checks.push("Network, malformed response, unavailable customer/cursor, expired session and retries");
    await command("Network.setBlockedURLs", { urls: ["*localhost:4338/api/backend/customers/*/sales*"] });
    await click("Consultar ventas"); await waitText("No se pudo conectar con la API");
    await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*"] });
    await click("Reintentar ventas"); await waitText("Comprador original"); checks.push("Actual browser network failure and explicit retry");
    detailMode = "MISSING"; await click("Ver líneas de venta 00000000"); await waitText("Venta no encontrada.");
    detailMode = "INVALID"; await click("Reintentar detalle"); await waitText("La respuesta de ventas no es válida");
    detailMode = "NORMAL"; await click("Reintentar detalle"); await waitText("Producto histórico"); checks.push("Missing sale, invalid detail and successful retry");
    mode = "HOLD"; await click("Consultar ventas"); await waitText("Cargando ventas"); await poll(() => Boolean(release));
    await choose(archived.id); mode = "EMPTY"; await click("Consultar ventas"); await waitText("No hay ventas vinculadas");
    release(); await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(!(await text()).includes("Comprador original")); checks.push("Archived customer, empty history and discarded late response from previous customer");
    await choose(customer.id); mode = "NORMAL"; await click("Consultar ventas"); await waitText("Comprador original");
    await evaluate(`(()=>{const s=${root}.querySelectorAll('select')[1];s.value='RETURNED';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    assert.ok(!(await text()).includes("Comprador original")); await click("Consultar ventas"); await waitText("Devuelta"); checks.push("Status filter resets previous results and cursor");
    searchMode = "ERROR"; await click("Buscar clientes"); await waitText("Error de búsqueda");
    searchMode = "INVALID"; await click("Reintentar búsqueda"); await waitText("La respuesta de ventas no es válida");
    searchMode = "EMPTY"; await click("Reintentar búsqueda"); await waitText("No se encontraron clientes");
    searchMode = "NORMAL"; await click("Buscar clientes"); await waitText("Selecciona un cliente");
    await fill('section[aria-label="Ventas vinculadas a un cliente"] input', "Otro nombre");
    assert.equal(await evaluate(`${root}.querySelectorAll('select').length`), 1);
    checks.push("Search errors, empty responses, retry and input invalidation");
    searchMode = "PAGED"; await click("Buscar clientes"); await waitText("Más clientes");
    await click("Más clientes"); await waitText("No se encontraron clientes en esta página");
    await click("Clientes anteriores"); await waitText("Selecciona un cliente");
    await evaluate(`${root}.querySelector('input').focus()`);
    assert.equal(await evaluate(`document.activeElement===${root}.querySelector('input')`), true);
    for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitText("Selecciona un cliente"); checks.push("Customer pagination, empty out-of-range page and keyboard search");
    assert.ok(requests.every(r => r.method === "GET")); assert.deepEqual(unknown, []);
    console.log(JSON.stringify({ checks, requests: requests.length, writes: 0 }, null, 2));
  }, { browser: "chrome", sandbox: false });
} catch (error) { console.error(error); process.exitCode = 1; }
