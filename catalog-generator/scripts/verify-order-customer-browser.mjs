import assert from "node:assert/strict";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Only local Next + an HTTPS persistence double. No real account, API or database.
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const catalogId = uuid(1), foreignCatalogId = uuid(2), existingId = uuid(90), saleId = uuid(80);
const catalog = { id: catalogId, publicId: catalogId, name: "Tienda de prueba", slug: "prueba", template: "TECH", active: true, archivedAt: null, logoUrl: null };
const sale = { id: saleId, status: "CONFIRMED", version: 1, total: "4000", lines: [{ itemName: "Artículo", quantity: 1, unitPrice: "4000", unitDiscount: "0", lineTotal: "4000" }], customerNameSnapshot: "Comprador original", customerPhoneSnapshot: "3000000000", customerEmailSnapshot: null };
const order = (index, patch = {}) => ({ id: uuid(index), customerName: `Comprador ${index}`, customerPhone: "3000000000", customerEmail: "buyer@example.invalid", customerAddress: "Dirección de prueba", notes: "Nota del pedido", customerConsentAt: null, customerConsentVersion: null, anonymizedAt: null, quotationSellerSnapshot: null, status: "PENDING", total: 4000, createdAt: "2026-11-23T12:00:00.000Z", quotationNumber: null, items: [{ productName: "Artículo", quantity: 1, unitPrice: 4000, subtotal: 4000 }], convertedSale: null, ...patch });
const orders = [
  order(10, { customerName: "Comprador válido", convertedSale: sale }),
  order(11, { status: "CANCELLED" }), order(12, { status: "COMPLETED", anonymizedAt: "2026-11-23T12:00:00Z" }),
  order(13, { customerName: " " }), order(14, { customerPhone: "" }), order(15, { customerPhone: "300" }),
  order(16, { customerName: "Comprador sin correo", customerEmail: null, customerAddress: null, notes: null }),
];
const originalOrders = structuredClone(orders);
const match = { id: existingId, fullName: "Cliente coincidente", phone: "3000000000", email: "existing@example.invalid" };
const previews = [], confirmations = [], created = [], associations = [], unknown = [], completed = new Map(), checks = [];
let initialMatches = [], initialHasMore = false, mode = "MATCH", stage = "startup", orderReads = 0;
let previewMode = "NORMAL", pageMode = "NORMAL", holdPreview = false, releasePreview = null;
const matchRequests = [];

async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET") {
    if (url.pathname === "/api/me") return reply({ user: { emailVerifiedAt: "2026-11-23T00:00:00Z", hasLocalPassword: true } });
    if (url.pathname === "/api/catalogs") return reply({ catalogs: [catalog] });
    if (url.pathname === `/api/catalogs/${catalogId}`) return reply({ catalog });
    if (url.pathname === `/api/categories/catalog/${catalogId}`) return reply({ categories: [] });
    if (url.pathname.includes(foreignCatalogId)) return reply({ message: "Catálogo no encontrado." }, 404);
    if (url.pathname.endsWith("/featured")) return reply({ products: [], selectedCount: 0, validCount: 0, visible: false, warning: null });
    if (url.pathname.endsWith("/list")) return reply({ products: [], page: 1, pageSize: 24, totalProducts: 0, totalFiltered: 0, totalPages: 1, needsCompletionCount: 0 });
    if (url.pathname.endsWith("/suggestions")) return reply({ products: [] });
    if (url.pathname === `/api/orders/catalog/${catalogId}`) { orderReads++; return reply({ orders, nextCursor: null }); }
    if (url.pathname === `/api/orders/${orders[0].id}/customer-matches`) {
      const page = Number(url.searchParams.get("page")); const phone = url.searchParams.get("phone");
      assert.equal(phone, match.phone); matchRequests.push({ page, phone });
      if (pageMode === "INVALID") return reply({ result: { matches: [{ ...match, phone: "3110000000" }], page: page + 1, hasMore: false } });
      return reply({ result: { matches: pageMode === "EMPTY" || page > 1 ? [] : [match], page, hasMore: false } });
    }
    unknown.push(url.pathname); return reply({}, 404);
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const source = orders.find(order => url.pathname === `/api/orders/${order.id}/customer-preview` || url.pathname === `/api/orders/${order.id}/customer-confirm`);
  if (!source) { unknown.push(`${req.method} ${url.pathname}`); return reply({}, 404); }
  assert.notEqual(source.status, "CANCELLED"); assert.equal(source.anonymizedAt, null);
  if (url.pathname.endsWith("/customer-preview")) {
    assert.deepEqual(body, {}); previews.push(source.id);
    if (holdPreview) await new Promise(resolve => { releasePreview = resolve; });
    if (previewMode === "INVALID") return reply({ success: true, result: null });
    return reply({ success: true, result: { fields: { fullName: source.customerName, phone: source.customerPhone, email: source.customerEmail, address: source.customerAddress, notes: source.notes }, customerId: null, existingCustomer: null, sale: source.convertedSale ? { id: saleId, customerId: null } : null, matches: initialMatches, hasMore: initialHasMore, invalidFields: [] } });
  }
  confirmations.push(structuredClone(body));
  assert.match(body.operationId, /^[0-9a-f-]{36}$/);
  if (body.action === "CREATE") {
    assert.deepEqual(Object.keys(body).sort(), ["operationId", "action", "customer", "associateSale"].sort());
    assert.deepEqual(Object.keys(body.customer).sort(), ["fullName", "phone", "email", "address", "notes"].sort());
  } else {
    assert.equal(body.action, "USE_EXISTING"); assert.equal(body.customerId, existingId);
    assert.deepEqual(Object.keys(body).sort(), ["operationId", "action", "customerId", "phone", "associateSale"].sort());
  }
  if (mode === "MATCH") return reply({ error: "CUSTOMER_PHONE_MATCH", message: "Ya hay clientes activos con este teléfono. Elige uno expresamente.", matches: [match], hasMore: false }, 409);
  if (mode === "EMPTY_MATCH") return reply({ error: "CUSTOMER_PHONE_MATCH", message: "Coincidencia no disponible", matches: [], hasMore: false }, 409);
  if (mode === "NOT_FOUND") return reply({ error: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado." }, 404);
  if (mode === "ARCHIVED") return reply({ error: "CUSTOMER_ARCHIVED", message: "El cliente seleccionado está archivado." }, 409);
  const previous = completed.get(body.operationId);
  if (previous) return reply({ success: true, result: { ...previous, idempotent: true } });
  const customer = body.action === "CREATE" ? { id: uuid(100 + created.length), ...body.customer } : match;
  if (body.action === "CREATE") created.push(customer);
  const result = { customer, orderId: source.id, associatedSaleId: body.associateSale ? saleId : null, idempotent: false };
  completed.set(body.operationId, result); associations.push(result);
  if (mode === "RESPONSE_LOST") return reply({ message: "No se pudo recibir la confirmación. Reintenta con los mismos datos." }, 503);
  return reply({ success: true, result });
}

const card = name => `[...document.querySelectorAll('article')].find(card => card.querySelector('h3')?.textContent === ${JSON.stringify(name)})`;
const review = (name, code) => `(()=>{const root=(${card(name)})?.querySelector('section[aria-label="Guardar comprador como cliente"]');if(!root)throw Error('REVIEW_MISSING');${code}})()`;

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, click }) => {
    const clickReview = async (name, label) => assert.equal(await evaluate(review(name, `const button=[...root.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true;`)), true, "Unavailable review action: " + label);
    const fill = async (name, label, text) => {
      await evaluate(review(name, `const label=[...root.querySelectorAll('label')].find(label=>label.textContent.trim().startsWith(${JSON.stringify(label)}));const input=label.querySelector('input,textarea');input.focus();input.select();`));
      await command("Input.insertText", { text });
    };
    const named = "Comprador válido", optional = "Comprador sin correo";
    stage = "dashboard-navigation";
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/catalogos" });
    await poll(() => evaluate(`Boolean(document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]'))`));
    assert.equal(await evaluate(`document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]').textContent.includes('Abrir panel')`), true);
    await evaluate(`document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]').focus()`);
    for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await poll(() => evaluate(`location.pathname==='/dashboard/catalogos/${catalogId}'&&Boolean([...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Órdenes'))`));
    assert.equal(orderReads, 0);
    await click("Órdenes"); await poll(() => evaluate(`document.querySelectorAll('article').length===${orders.length}`));
    assert.equal(await evaluate(`document.querySelector('nav[aria-label="Secciones del catálogo"] button[aria-current=page]').textContent.trim()`), "Órdenes");
    assert.equal(orderReads, 1); assert.equal(created.length, 0); assert.equal(confirmations.length, 0);
    checks.push("Dashboard → Abrir panel → actual catalog route → Órdenes mounts the real OrdersPanel; no automatic customer creation");

    stage = "eligibility";
    assert.equal(await evaluate(`document.querySelectorAll('section[aria-label="Guardar comprador como cliente"]').length`), 2);
    for (const source of orders.slice(1, 6)) assert.equal(await evaluate(`(${card(source.customerName)})?.querySelector('section[aria-label="Guardar comprador como cliente"]')===null`), true);
    checks.push("Actions shown for valid required data; hidden for cancelled/anonymized orders, blank name/phone and insufficient phone digits; optional email/address do not hide the action");

    stage = "preview-and-cancel";
    holdPreview = true;
    await clickReview(named, "Guardar comprador como cliente");
    await poll(() => typeof releasePreview === "function");
    assert.equal(await evaluate(review(named, "return root.querySelector('button').disabled;")), true);
    await evaluate(review(named, "root.querySelector('button').click();")); assert.equal(previews.length, 1);
    holdPreview = false; releasePreview(); releasePreview = null;
    await poll(() => evaluate(review(named, "return Boolean(root.querySelector('form'));")));
    assert.equal(previews.length, 1); assert.equal(confirmations.length, 0); assert.equal(created.length, 0);
    assert.equal(await evaluate(review(named, "return root.querySelector('input').value;")), named);
    await fill(named, "Nombre completo", "Cambio sin guardar"); await fill(named, "Notas", "Nota sin guardar");
    await clickReview(named, "Cancelar"); assert.equal(confirmations.length, 0); assert.deepEqual(orders, originalOrders);
    checks.push("Preview sends only {} to the read-only preview endpoint; editing and cancelling send no confirmation and change no stored data");

    stage = "phone-match-and-errors";
    await clickReview(named, "Guardar comprador como cliente");
    await poll(() => evaluate(review(named, "return Boolean(root.querySelector('form'));")));
    await clickReview(named, "Crear cliente");
    await poll(() => evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")));
    assert.equal(confirmations.length, 1); assert.equal(created.length, 0); assert.equal(associations.length, 0);
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Crear cliente').disabled;")), true);
    stage = "phone-match-edits";
    await fill(named, "Nombre completo", "Nombre corregido sin cambiar teléfono");
    assert.equal(await evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")), true, "Editing a name must not discard an unchanged phone match");
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Crear cliente').disabled;")), true);
    await fill(named, "Teléfono", "(300) 000-0000");
    assert.equal(await evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")), true);
    await evaluate(review(named, "root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));"));
    assert.equal(confirmations.length, 1, "An unchanged match must block create even via a programmatic submit");
    mode = "NOT_FOUND"; await clickReview(named, "Usar cliente existente");
    await poll(() => evaluate(review(named, "return root.querySelector('[role=alert]')?.textContent==='Cliente no encontrado.';")));
    mode = "ARCHIVED"; await clickReview(named, "Usar cliente existente");
    await poll(() => evaluate(review(named, "return root.querySelector('[role=alert]')?.textContent==='El cliente seleccionado está archivado.';")));
    assert.equal(created.length, 0); assert.equal(associations.length, 0);
    await clickReview(named, "Cancelar"); assert.equal(confirmations.length, 3);
    checks.push("CUSTOMER_PHONE_MATCH displays explicit existing-client options without auto-selection; CUSTOMER_NOT_FOUND and CUSTOMER_ARCHIVED remain visible; cancellation performs no write");

    stage = "explicit-existing-and-sale";
    initialMatches = [match]; mode = "SUCCESS";
    await clickReview(named, "Guardar comprador como cliente");
    await poll(() => evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")));
    assert.equal(await evaluate(review(named, "return root.querySelector('input[type=checkbox]').checked;")), false);
    await evaluate(review(named, "root.querySelector('input[type=checkbox]').click();"));
    await clickReview(named, "Usar cliente existente");
    await poll(() => evaluate(review(named, "return root.textContent.includes('Cliente existente asociado al pedido.');")));
    assert.equal(confirmations.at(-1).action, "USE_EXISTING"); assert.equal(confirmations.at(-1).associateSale, true);
    assert.equal(created.length, 0); assert.equal(associations.length, 1); assert.deepEqual(sale, originalOrders[0].convertedSale);
    checks.push("Existing-client selection and sale association require explicit buttons/checkbox; no snapshots, prices, stock or states are posted");

    stage = "create-edit-and-idempotent-retry";
    initialMatches = []; mode = "RESPONSE_LOST";
    await clickReview(optional, "Guardar comprador como cliente");
    await poll(() => evaluate(review(optional, "return Boolean(root.querySelector('form'));")));
    await fill(optional, "Nombre completo", "Cliente revisado"); await fill(optional, "Teléfono", "3110000000");
    await fill(optional, "Correo", "edited@example.invalid"); await fill(optional, "Dirección", "Dirección revisada"); await fill(optional, "Notas", "Notas revisadas");
    await clickReview(optional, "Crear cliente");
    await poll(() => evaluate(review(optional, "return root.textContent.includes('Reintenta con los mismos datos.');")));
    const first = confirmations.at(-1); assert.equal(first.customer.fullName, "Cliente revisado"); assert.equal(first.customer.phone, "3110000000");
    assert.equal(first.customer.email, "edited@example.invalid"); assert.equal(first.customer.address, "Dirección revisada"); assert.equal(first.customer.notes, "Notas revisadas");
    assert.equal(first.associateSale, false); assert.equal(created.length, 1);
    await clickReview(optional, "Crear cliente");
    await poll(() => evaluate(review(optional, "return root.textContent.includes('Cliente creado y asociado al pedido.');")));
    assert.equal(confirmations.at(-1).operationId, first.operationId); assert.deepEqual(confirmations.at(-1), first); assert.equal(created.length, 1);
    assert.deepEqual(orders, originalOrders);
    checks.push("Edited fields submitted only after explicit create; a lost response retries the exact command/key without a duplicate; buyer fields, snapshots and order states unchanged");

    stage = "match-pagination-and-empty";
    const writesBeforePages = confirmations.length;
    initialMatches = [match]; initialHasMore = true;
    await clickReview(named, "Guardar comprador como cliente");
    await poll(() => evaluate(review(named, "return root.textContent.includes('Más coincidencias');")));
    await clickReview(named, "Más coincidencias");
    await poll(() => evaluate(review(named, "return root.textContent.includes('No hay coincidencias en esta página.');")));
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Anterior').disabled;")), false);
    await clickReview(named, "Anterior");
    await poll(() => evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")));
    pageMode = "INVALID"; await clickReview(named, "Actualizar coincidencias");
    await poll(() => evaluate(review(named, "return root.querySelector('[role=alert]')?.textContent.includes('No se pudo validar la página');")));
    assert.equal(await evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")), true);
    pageMode = "EMPTY"; await clickReview(named, "Actualizar coincidencias");
    await poll(() => evaluate(review(named, "return root.textContent.includes('Ya no hay coincidencias activas');")));
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Crear cliente').disabled;")), false);
    assert.equal(confirmations.length, writesBeforePages); await clickReview(named, "Cancelar");
    assert.ok(matchRequests.some(request => request.page === 2)); assert.ok(matchRequests.some(request => request.page === 1));
    checks.push("All three endpoints exercised: loading blocks repeat preview; match pagination handles empty pages and stale/malformed responses; refresh never confirms automatically");

    stage = "preview-errors-and-local-preparation";
    initialMatches = []; initialHasMore = false; previewMode = "INVALID";
    await clickReview(named, "Guardar comprador como cliente");
    await poll(() => evaluate(review(named, "return root.querySelector('[role=alert]')?.textContent.includes('No se pudo validar la revisión');")));
    assert.equal(await evaluate(review(named, "return root.querySelector('button').disabled;")), false);
    previewMode = "NORMAL"; await clickReview(named, "Guardar comprador como cliente");
    await poll(() => evaluate(review(named, "return Boolean(root.querySelector('form'));")));
    await evaluate("window.__reviewOriginalUuid=crypto.randomUUID.bind(crypto);Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>{throw Error('synthetic failure')}})");
    await clickReview(named, "Crear cliente");
    await poll(() => evaluate(review(named, "return root.querySelector('[role=alert]')?.textContent.includes('No se pudo preparar la confirmación');")));
    assert.equal(confirmations.length, writesBeforePages);
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Cancelar').disabled;")), false);
    await evaluate("Object.defineProperty(crypto,'randomUUID',{configurable:true,value:window.__reviewOriginalUuid});delete window.__reviewOriginalUuid");
    await clickReview(named, "Cancelar");
    checks.push("Invalid preview and local UUID preparation errors release loading, preserve cancellation and cause no confirmation request");

    stage = "malformed-match-blocks-create";
    mode = "EMPTY_MATCH";
    await clickReview(named, "Guardar comprador como cliente"); await poll(() => evaluate(review(named, "return Boolean(root.querySelector('form'));")));
    await clickReview(named, "Crear cliente");
    await poll(() => evaluate(review(named, "return root.querySelector('[role=alert]')?.textContent.includes('No se pudieron validar las coincidencias');")));
    const failedMatchCount = confirmations.length;
    await fill(named, "Notas", "Cambio de nota");
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Crear cliente').disabled;")), true);
    await evaluate(review(named, "root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));"));
    assert.equal(confirmations.length, failedMatchCount); await clickReview(named, "Cancelar");
    initialMatches = [match]; mode = "SUCCESS";
    await clickReview(named, "Guardar comprador como cliente"); await poll(() => evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")));
    await fill(named, "Teléfono", "3110000000");
    assert.equal(await evaluate(review(named, "return [...root.querySelectorAll('button')].find(button=>button.textContent==='Crear cliente').disabled;")), false);
    assert.equal(await evaluate(review(named, "return root.textContent.includes('Cliente coincidente');")), false);
    await clickReview(named, "Cancelar"); assert.equal(confirmations.length, failedMatchCount);
    checks.push("Malformed phone conflicts fail closed; unrelated edits retain matches and only changing the phone can prepare a fresh explicit create");

    stage = "foreign-catalog";
    const readCount = orderReads, writeCount = confirmations.length;
    await command("Page.navigate", { url: `http://localhost:4338/dashboard/catalogos/${foreignCatalogId}` });
    await poll(() => evaluate("document.body.textContent.includes('Catálogo no encontrado.')"));
    assert.equal(await evaluate(`document.querySelectorAll('section[aria-label="Guardar comprador como cliente"]').length`), 0);
    assert.equal(orderReads, readCount); assert.equal(confirmations.length, writeCount);
    assert.deepEqual(unknown, []);
    checks.push("A catalog denied by the private API never mounts orders or customer actions; ownership remains a server decision");
  }, { browser: "chrome", sandbox: false });
  console.log(JSON.stringify({ success: true, route: "/dashboard/catalogos/[catalogId] → Órdenes", productionAccess: false, realDatabase: false, checks, previewRequests: previews.length, confirmationRequests: confirmations.length, customersCreatedInDouble: created.length }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, stage, error: error instanceof Error ? error.message : "CHECK_FAILED", productionAccess: false, realDatabase: false })); process.exitCode = 1;
}
