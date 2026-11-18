import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { verifyInventorySheet } from "./inventory-sheet-e2e.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.resolve(root, "../catalog-api");
const requireApi = createRequire(path.join(apiRoot, "package.json"));
const uiPort = 4358, apiPort = 4359, base = `http://localhost:${uiPort}`;
let stage = "TARGET_GUARD", folder, schema, db, backend, app, ui, chrome, socket;
const passed = [], pending = new Map(); let serial = 0, dropResponse = false, droppedRequest;
const browserErrors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function pass() { passed.push(stage); console.log(`PASS ${stage}`); }
async function poll(work, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await work()) return; await wait(75); }
  throw new Error(`TIMEOUT_${stage}`);
}
function command(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT_${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("BROWSER_EVALUATION_FAILED");
  return result.result.value;
}
const text = () => evaluate("document.body.innerText");
async function click(label, selector = "button") {
  assert.ok(await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!element||element.disabled)return false;element.click();return true})()`), "ENABLED_CONTROL_REQUIRED");
}
async function fillSelector(selector, value) {
  assert.ok(await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;const prototype=node.tagName==='SELECT'?HTMLSelectElement.prototype:node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`));
}
async function fill(label, value) {
  assert.ok(await evaluate(`(()=>{const node=[...document.querySelectorAll('label')].find(e=>e.firstChild?.textContent.trim()===${JSON.stringify(label)})?.querySelector('input,select');if(!node)return false;const prototype=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`));
}
async function request(url, method = "GET", body) {
  return evaluate(`(async()=>{const response=await fetch(${JSON.stringify(`/api/backend${url}`)},{method:${JSON.stringify(method)},credentials:'same-origin',headers:{'Content-Type':'application/json'},${body === undefined ? "" : `body:JSON.stringify(${JSON.stringify(body)}),`}cache:'no-store'});return {status:response.status,body:await response.json()}})()`);
}
async function inventory() {
  await command("Page.navigate", { url: `${base}/dashboard/inventario` });
  await poll(() => evaluate("document.querySelector('h1')?.textContent==='Inventario'&&!document.body.innerText.includes('Cargando inventario')"), 60000);
}
async function signIn(account, register = false) {
  await command("Page.navigate", { url: `${base}/login` });
  await poll(() => evaluate("(()=>{const input=document.querySelector('input[type=password]');return Boolean(input&&Object.keys(input).some(key=>key.startsWith('__reactProps$')));})()"), 60000);
  if (register) {
    await click("Crear cuenta", "button[type=button]");
    await poll(() => evaluate("document.querySelector('h1')?.textContent==='Crea tu cuenta.'"));
  }
  await fillSelector("input[type=email]", account.email);
  await fillSelector("input[type=password]", account.password);
  await click(register ? "Crear cuenta" : "Entrar al panel", "button[type=submit]");
  await poll(() => evaluate("location.pathname==='/dashboard'&&Boolean(document.querySelector('header'))"), 60000);
  await inventory();
}
async function signOut() {
  await click("Cerrar sesión");
  await poll(() => evaluate("location.pathname==='/login'"));
  await poll(async () => (await request("/inventory/items")).status === 401);
}
async function saveMovement(type, quantity, reason, stock) {
  await fill("Tipo", type);
  await fill(type === "ADJUSTMENT" ? "Existencia final contada" : "Cantidad", String(quantity));
  await fill("Motivo", reason); await click("Registrar movimiento");
  await poll(async () => (await text()).includes(`Existencias al consultar: ${stock}.`) && (await text()).includes("Movimiento registrado."));
}

try {
  let raw = ""; for await (const chunk of process.stdin) { raw += String(chunk); assert.ok(raw.length < 8192); }
  const { inventoryTestTarget } = requireApi("./dist/scripts/verify-inventory-postgres.js");
  const target = await inventoryTestTarget(raw); raw = "";
  schema = `inventory_e2e_${randomBytes(8).toString("hex")}`;
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connect_timeout", "5");
  const { PrismaClient } = requireApi("@prisma/client");
  db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const [identity] = await db.$queryRaw`SELECT current_database() AS database, host(inet_server_addr()) AS address`;
  assert.equal(identity.database, "catalogo_test"); assert.ok(["127.0.0.1", "::1"].includes(identity.address));
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); await db.$disconnect();
  const [namespace] = await db.$queryRaw`SELECT current_schema() AS name`; assert.equal(namespace.name, schema); pass();

  stage = "ALL_MIGRATIONS_AND_CONSTRAINTS";
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "vitrinaya-inventory-e2e-"));
  const migrationsFolder = path.join(folder, "database"); await fs.mkdir(migrationsFolder);
  await fs.cp(path.join(apiRoot, "prisma/schema.prisma"), path.join(migrationsFolder, "schema.prisma"));
  await fs.cp(path.join(apiRoot, "prisma/migrations"), path.join(migrationsFolder, "migrations"), { recursive: true });
  const env = Object.fromEntries(["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "ComSpec", "APPDATA", "LOCALAPPDATA"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.DATABASE_URL = target.toString();
  const migration = spawnSync(process.execPath, [requireApi.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(migrationsFolder, "schema.prisma")], { cwd: migrationsFolder, env, encoding: "utf8", timeout: 60000, windowsHide: true });
  assert.equal(migration.status, 0, "MIGRATION_DEPLOY_FAILED");
  const ledger = await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const names = (await fs.readdir(path.join(apiRoot, "prisma/migrations"), { withFileTypes: true })).filter(value => value.isDirectory()).map(value => value.name).sort();
  assert.deepEqual(ledger.map(value => value.migration_name), names);
  const [constraint] = await db.$queryRaw`SELECT convalidated FROM pg_constraint WHERE connamespace=${schema}::regnamespace AND conname='inventory_movements_balance_check'`;
  assert.equal(constraint.convalidated, true); pass();

  stage = "REAL_API_FRONTEND_AND_BROWSER";
  const backendEnv = { ...env, NODE_ENV: "development", JWT_SECRET: randomBytes(48).toString("hex"), MAIL_MODE: "log", APP_PUBLIC_URL: base, SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SECRET_KEY: "e2e-unused-placeholder", CORS_ORIGINS: base };
  async function startBackend() {
    backend = spawn(process.execPath, ["-e", `const app=require(${JSON.stringify(path.join(apiRoot, "dist/app.js"))}).default;app.listen(${apiPort},'127.0.0.1',()=>console.log('API_READY'));`], {
      cwd: folder, env: backendEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false; backend.stdout.on("data", chunk => { if (chunk.toString().includes("API_READY")) ready = true; }); backend.stderr.on("data", () => {});
    await poll(() => { assert.equal(backend.exitCode, null, "BACKEND_START_FAILED"); return ready; });
  }
  await startBackend();
  const frontend = path.join(folder, "frontend"); await fs.mkdir(frontend);
  for (const name of ["app", "components", "lib", "public", "package.json", "package-lock.json", "tsconfig.json", "postcss.config.mjs", "next.config.ts"]) if (existsSync(path.join(root, name))) await fs.cp(path.join(root, name), path.join(frontend, name), { recursive: true });
  await fs.symlink(path.join(root, "node_modules"), path.join(frontend, "node_modules"), "junction");
  process.env.NODE_ENV = "development"; process.env.CATALOG_API_URL = `http://127.0.0.1:${apiPort}/api`; process.env.NEXT_PUBLIC_CATALOG_API_URL = process.env.CATALOG_API_URL;
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = ""; process.env.NEXT_TELEMETRY_DISABLED = "1";
  app = require("next")({ dir: frontend, dev: true, webpack: true, hostname: "localhost", port: uiPort }); await app.prepare();
  ui = http.createServer(app.getRequestHandler()); ui.listen(uiPort, "127.0.0.1"); await once(ui, "listening");
  const executable = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync); assert.ok(executable, "CHROME_OR_EDGE_REQUIRED");
  const profile = path.join(folder, "browser-profile");
  chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  await poll(() => existsSync(path.join(profile, "DevToolsActivePort")));
  const port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl); await once(socket, "open");
  socket.addEventListener("message", event => {
    const value = JSON.parse(event.data);
    if (value.id) { const entry = pending.get(value.id); pending.delete(value.id); if (!entry) return; if (value.error) entry.reject(new Error("CDP_COMMAND_FAILED")); else entry.resolve(value.result); }
    if (value.method === "Runtime.exceptionThrown") browserErrors.push("UNHANDLED_BROWSER_EXCEPTION");
    if (value.method === "Fetch.requestPaused") {
      if (dropResponse && value.params.responseStatusCode === 200) {
        dropResponse = false; droppedRequest = JSON.parse(value.params.request.postData);
        void command("Fetch.failRequest", { requestId: value.params.requestId, errorReason: "Failed" });
      } else void command("Fetch.continueRequest", { requestId: value.params.requestId });
    }
  });
  await command("Page.enable"); await command("Runtime.enable"); await command("Network.enable"); pass();

  const accountA = { email: `e2e_${randomUUID()}@example.invalid`, password: randomBytes(24).toString("hex") };
  const accountB = { email: `e2e_${randomUUID()}@example.invalid`, password: randomBytes(24).toString("hex") };
  stage = "REAL_REGISTRATION_AND_EMPTY_WAREHOUSE";
  await signIn(accountA, true);
  await poll(async () => (await text()).includes("No hay productos para esta búsqueda"));
  const ownerA = await db.user.findUniqueOrThrow({ where: { email: accountA.email } });
  assert.equal(await db.catalog.count({ where: { userId: ownerA.id } }), 0);
  assert.equal(await evaluate("document.cookie.includes('catalogo_session')"), false);
  assert.equal(await evaluate("'token' in JSON.parse(localStorage.getItem('catalogo-session'))"), false); pass();

  stage = "SKU_VALID_INVALID_DUPLICATE_AND_MINIMUM";
  await fill("Nombre", "Artículo E2E"); await fill("SKU / código", "   "); await click("Crear producto");
  await poll(() => evaluate("Boolean(document.querySelector('section[aria-labelledby=new-item] [role=alert]'))"));
  assert.equal(await db.inventoryItem.count(), 0);
  await fill("SKU / código", "e2e-%_\\"); await fill("Existencia mínima", "3"); await click("Crear producto");
  await poll(async () => (await text()).includes("SKU: E2E-%_\\"));
  const item = await db.inventoryItem.findFirstOrThrow({ where: { userId: ownerA.id, sku: "E2E-%_\\" } }); assert.equal(item.minimumStock, 3);
  assert.ok((await text()).includes("Existencias bajas"));
  await fill("Nombre", "Duplicado E2E"); await fill("SKU / código", "e2e-%_\\"); await click("Crear producto");
  await poll(async () => (await text()).includes("El SKU o identificador ya está en uso"));
  assert.equal(await db.inventoryItem.count(), 1);
  assert.equal((await request("/inventory/items", "POST", { id: randomUUID(), name: "Invalid SKU", sku: "ß".repeat(80), minimumStock: 0 })).status, 400); pass();

  stage = "ENTRIES_EXITS_POSITIVE_AND_NEGATIVE_ADJUSTMENTS";
  await click("Movimientos de Artículo E2E");
  await saveMovement("IN", 10, "Entrada inicial E2E", 10);
  await saveMovement("OUT", 3, "Salida real E2E", 7);
  await saveMovement("ADJUSTMENT", 20, "Conteo al alza E2E", 20);
  await saveMovement("ADJUSTMENT", 4, "Conteo a la baja E2E", 4);
  const history = await request(`/inventory/items/${item.id}/movements`);
  assert.equal(history.status, 200); assert.equal(history.body.result.total, 4);
  assert.ok(history.body.result.movements.some(value => value.reason === "Conteo a la baja E2E")); pass();

  stage = "NEGATIVE_STOCK_AND_VISIBLE_VALIDATION";
  await fill("Tipo", "OUT"); await fill("Cantidad", "5"); await fill("Motivo", "Salida excesiva E2E"); await click("Registrar movimiento");
  await poll(async () => (await text()).includes("El movimiento excede las existencias"));
  assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 4);
  for (const body of [{ key: randomUUID(), type: "ADJUSTMENT", quantity: -1, reason: "Invalid negative" }, { key: randomUUID(), type: "IN", quantity: 1, reason: " " }]) assert.equal((await request(`/inventory/items/${item.id}/movements`, "POST", body)).status, 400);
  assert.equal(await db.inventoryMovement.count({ where: { itemId: item.id } }), 4); pass();

  stage = "COMMITTED_RESPONSE_LOSS_AND_REAL_RETRY";
  await command("Fetch.enable", { patterns: [{ urlPattern: "*/api/backend/inventory/items/*/movements", requestStage: "Response" }] });
  await fill("Tipo", "IN"); await fill("Cantidad", "2"); await fill("Motivo", "Reintento de red E2E"); dropResponse = true; await click("Registrar movimiento");
  await poll(async () => droppedRequest && (await text()).includes("No se pudo conectar con la API"));
  assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 6);
  await command("Fetch.disable"); await click("Registrar movimiento");
  await poll(async () => (await text()).includes("Movimiento registrado.") && (await text()).includes("Existencias al consultar: 6."));
  assert.equal(await db.inventoryMovement.count({ where: { itemId: item.id, key: droppedRequest.key } }), 1);
  assert.equal((await request(`/inventory/items/${item.id}/movements`, "POST", droppedRequest)).status, 200);
  assert.equal((await request(`/inventory/items/${item.id}/movements`, "POST", { ...droppedRequest, quantity: 3 })).status, 409); pass();

  stage = "RELOAD_RECONCILIATION_WITHOUT_AUTOMATIC_REPLAY";
  await command("Fetch.enable", { patterns: [{ urlPattern: "*/api/backend/inventory/items/*/movements", requestStage: "Response" }] });
  droppedRequest = undefined; dropResponse = true;
  await fill("Cantidad", "1"); await fill("Motivo", "Recarga incierta E2E"); await click("Registrar movimiento");
  await poll(async () => droppedRequest && (await text()).includes("No se pudo conectar con la API"));
  await command("Fetch.disable");
  const beforeReload = await db.inventoryMovement.count({ where: { itemId: item.id } });
  await command("Page.reload", { ignoreCache: true });
  await poll(async () => (await text()).includes("SKU: E2E-%_\\")); await click("Movimientos de Artículo E2E");
  await poll(async () => (await text()).includes("Recarga incierta E2E"));
  assert.equal(await db.inventoryMovement.count({ where: { itemId: item.id } }), beforeReload);
  assert.ok((await text()).includes("después de recargar la página, revisa el historial")); pass();

  stage = "CONCURRENT_PRODUCT_SKU_MOVEMENTS_AND_IDEMPOTENCY";
  const shared = { id: randomUUID(), name: "Concurrent product E2E", sku: "CONCURRENT", minimumStock: 0 };
  const sameId = await evaluate(`Promise.all(Array.from({length:6},async()=>{const r=await fetch('/api/backend/inventory/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(shared)})});return r.status}))`);
  assert.ok(sameId.every(status => status === 200)); assert.equal(await db.inventoryItem.count({ where: { id: shared.id } }), 1);
  const skuRace = await evaluate(`Promise.all(Array.from({length:6},async()=>{const r=await fetch('/api/backend/inventory/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),name:'SKU race E2E',sku:'SKU-RACE',minimumStock:0})});return r.status}))`);
  assert.equal(skuRace.filter(status => status === 200).length, 1); assert.ok(skuRace.every(status => status === 200 || status === 409));
  const entry = { key: randomUUID(), type: "IN", quantity: 10, reason: "Concurrent opening E2E" };
  const repeats = await evaluate(`Promise.all(Array.from({length:8},async()=>{const r=await fetch('/api/backend/inventory/items/${shared.id}/movements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(entry)})});return r.status}))`);
  assert.ok(repeats.every(status => status === 200));
  const exits = await evaluate(`Promise.all(Array.from({length:16},async()=>{const r=await fetch('/api/backend/inventory/items/${shared.id}/movements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:crypto.randomUUID(),type:'OUT',quantity:1,reason:'Concurrent exit E2E'})});return r.status}))`);
  assert.equal(exits.filter(status => status === 200).length, 10); assert.ok(exits.every(status => status === 200 || status === 409));
  assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: shared.id } })).stock, 0); pass();

  stage = "LITERAL_SEARCH_DESKTOP_MOBILE_AND_HISTORY_PAGINATION";
  for (let index = 0; index < 25; index++) assert.equal((await request("/inventory/items", "POST", { id: randomUUID(), name: `Paginado E2E ${index}`, sku: `PAGE-${index}`, minimumStock: 0 })).status, 200);
  for (let index = 0; index < 25; index++) assert.equal((await request(`/inventory/items/${item.id}/movements`, "POST", { key: randomUUID(), type: "IN", quantity: 1, reason: `Historial E2E ${index}` })).status, 200);
  await inventory();
  for (const term of ["%", "_", "\\"]) {
    await fill("Buscar por nombre o SKU", term); await click("Buscar");
    await poll(() => evaluate("document.querySelectorAll('article').length===1"));
    assert.ok((await text()).includes("Artículo E2E"));
  }
  for (const width of [1280, 320, 390]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await fill("Buscar por nombre o SKU", "Paginado E2E"); await click("Buscar");
    await poll(() => evaluate("document.querySelectorAll('article').length===24"));
    await click("Siguiente"); await poll(() => evaluate("document.querySelectorAll('article').length===1"));
    await click("Anterior"); await poll(() => evaluate("document.querySelectorAll('article').length===24"));
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await fs.writeFile(path.join(folder, `inventory-e2e-${width}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await fill("Buscar por nombre o SKU", "E2E-%"); await click("Buscar"); await poll(() => evaluate("document.querySelectorAll('article').length===1")); await click("Movimientos de Artículo E2E");
  await poll(async () => (await text()).includes("Historial E2E"));
  await click("Más movimientos"); await poll(async () => (await text()).includes("Entrada inicial E2E"));
  await click("Anteriores"); await poll(async () => (await text()).includes("Historial E2E")); pass();

  const sheetBatch = await verifyInventorySheet({ command, evaluate, click, fillSelector, poll, request, text, db, folder, base, pass, setStage: (name, lose = false) => { stage = name; if (lose) { droppedRequest = undefined; dropResponse = true; } } });
  stage = "API_RESTART_PRESERVES_SESSION_AND_BATCH_RECEIPT";
  // Separate the long suite into request budgets without weakening the real limiter.
  // A fresh process must recover the same database receipt with the existing cookie.
  if (backend.exitCode === null) { backend.kill(); await once(backend, "exit"); }
  await startBackend();
  const afterRestart = await request(`/inventory/batches/${sheetBatch}`);
  assert.equal(afterRestart.status, 200); assert.equal(afterRestart.body.result.status, "APPLIED"); assert.equal(afterRestart.body.result.receipt.movementCount, 1); pass();
  stage = "LOGOUT_LOGIN_AND_SECOND_USER_ISOLATION";
  await signOut(); await signIn(accountB, true);
  await poll(async () => (await text()).includes("No hay productos para esta búsqueda"));
  const ownerB = await db.user.findUniqueOrThrow({ where: { email: accountB.email } });
  assert.equal((await request(`/inventory/batches/${sheetBatch}`)).status, 404);
  assert.equal((await request(`/inventory/batches/${sheetBatch}/rows`)).status, 404);
  assert.equal((await request(`/inventory/items/${item.id}/movements`)).status, 404);
  assert.equal((await request(`/inventory/items/${item.id}/movements`, "POST", { key: randomUUID(), type: "IN", quantity: 1, reason: "Other owner attempt" })).status, 404);
  const bInput = { id: randomUUID(), name: "Artículo B E2E", sku: item.sku, minimumStock: 1 };
  assert.equal((await request("/inventory/items", "POST", bInput)).status, 200);
  assert.equal((await request(`/inventory/items/${bInput.id}/movements`, "POST", { key: randomUUID(), type: "IN", quantity: 2, reason: "B opening E2E" })).status, 200);
  await signOut(); await signIn(accountA);
  assert.equal((await request(`/inventory/items/${bInput.id}/movements`)).status, 404);
  assert.equal((await request(`/inventory/items/${bInput.id}/movements`, "POST", { key: randomUUID(), type: "OUT", quantity: 1, reason: "Other owner attempt" })).status, 404);
  assert.equal((await request("/inventory/items", "POST", { ...bInput, userId: ownerB.id })).status, 400);
  assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 32); pass();

  stage = "REAL_ACCOUNT_CLOSURE_AND_REJECTED_WRITES";
  await signOut(); await signIn(accountB);
  const bBefore = await db.inventoryMovement.count({ where: { itemId: bInput.id } });
  assert.equal((await request("/auth/close", "POST", { confirmation: "CERRAR CUENTA", password: accountB.password })).status, 202);
  assert.equal((await request("/inventory/items", "POST", { id: randomUUID(), name: "After closure", sku: "CLOSED", minimumStock: 0 })).status, 401);
  assert.equal((await request("/inventory/batches", "POST", { id: randomUUID(), source: "GRID", totalRows: 1 })).status, 401);
  assert.equal((await request(`/inventory/items/${bInput.id}/movements`, "POST", { key: randomUUID(), type: "IN", quantity: 1, reason: "After closure" })).status, 401);
  await fill("Nombre", "Tras cierre E2E"); await fill("SKU / código", "CLOSED-UI"); await click("Crear producto");
  await poll(async () => (await text()).includes("Tu sesión expiró. Inicia sesión para continuar."));
  assert.equal(await db.inventoryMovement.count({ where: { itemId: bInput.id } }), bBefore);
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: ownerB.id } })).closedAt); pass();

  stage = "BALANCE_LEDGER_RECONCILIATION_AND_REOPEN_SESSION";
  await signIn(accountA);
  for (const row of await db.inventoryItem.findMany()) {
    const entries = await db.inventoryMovement.findMany({ where: { itemId: row.id } });
    const balance = entries.reduce((total, movement) => total + movement.resultingStock - movement.previousStock, 0);
    assert.equal(balance, row.stock);
    for (const movement of entries) {
      const expected = movement.type === "ADJUSTMENT" ? movement.quantity : movement.previousStock + (movement.type === "IN" ? movement.quantity : -movement.quantity);
      assert.equal(movement.resultingStock, expected); assert.ok(movement.previousStock >= 0 && movement.resultingStock >= 0);
    }
  }
  const reconciledHistory = await request(`/inventory/items/${item.id}/movements`);
  assert.equal(reconciledHistory.status, 200); assert.equal(reconciledHistory.body.result.total, 31);
  assert.deepEqual(browserErrors, []); pass();
  const summary = { passed: passed.length, scenarios: passed, schema, migrationCount: names.length, realPostgres: true, realBackend: true, realFrontend: true, realAuthentication: true, realBrowser: true, simulatedApi: false, productionAccess: false, retainedSyntheticData: true, artifacts: folder };
  await fs.writeFile(path.join(folder, "inventory-e2e-results.json"), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} catch (error) {
  const line = error instanceof Error ? error.stack?.match(/verify-inventory-e2e\.mjs:(\d+):\d+/)?.[1] : undefined;
  console.error(`FAIL ${stage}: ${error instanceof Error ? error.name : "ERROR"}${line ? ` at script line ${line}` : ""}`); process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) await command("Browser.close").catch(() => {});
  socket?.close(); if (chrome && chrome.exitCode === null) { chrome.kill(); await Promise.race([once(chrome, "exit"), wait(2000)]); }
  if (ui) { ui.closeAllConnections(); await Promise.race([new Promise(resolve => ui.close(resolve)), wait(2000)]); }
  await Promise.race([app?.close(), wait(5000)]);
  if (backend && backend.exitCode === null) { backend.kill(); await Promise.race([once(backend, "exit"), wait(2000)]); }
  await db?.$disconnect(); process.exit(process.exitCode ?? 0);
}
