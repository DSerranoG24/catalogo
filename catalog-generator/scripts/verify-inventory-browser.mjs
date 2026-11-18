import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vitrinaya-inventory-browser-"));
const uiPort = 4348, apiPort = 4349;
const base = `http://localhost:${uiPort}`;
let stage = "SETUP", app, ui, api, chrome, socket;
const items = [], movements = [], posts = [], browserErrors = [];
let loseReply = false, failList = false, expired = false;
const passed = [];
function pass(name) { passed.push(name); console.log(`PASS ${name}`); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(work, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await work()) return; await wait(75); }
  throw new Error(`TIMEOUT_${stage}`);
}
const pending = new Map(); let serial = 0;
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
async function click(label) {
  assert.ok(await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true})()`), `Missing enabled button: ${label}`);
}
async function fill(label, value) {
  assert.ok(await evaluate(`(()=>{const node=[...document.querySelectorAll('label')].find(e=>e.firstChild?.textContent===${JSON.stringify(label)})?.querySelector('input,select');if(!node)return false;const prototype=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`));
}
function fixtureItem(name, sku) { const item = { id: randomUUID(), name, sku, stock: 0, minimumStock: 2 }; items.push(item); return item; }

try {
  // Test a source copy without reading .env files or changing the project's tool configuration.
  for (const name of ["app", "components", "lib", "public", "package.json", "package-lock.json", "tsconfig.json", "postcss.config.mjs", "next.config.ts"]) {
    if (existsSync(path.join(root, name))) await fs.cp(path.join(root, name), path.join(folder, name), { recursive: true });
  }
  await fs.symlink(path.join(root, "node_modules"), path.join(folder, "node_modules"), "junction");
  process.env.NODE_ENV = "development";
  process.env.CATALOG_API_URL = `http://127.0.0.1:${apiPort}/api`;
  process.env.NEXT_PUBLIC_CATALOG_API_URL = process.env.CATALOG_API_URL;
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  api = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const reply = (body, status = 200) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (expired) return reply({ message: "Session expired fixture" }, 401);
    if (req.headers.authorization !== "Bearer inventory-browser-fixture") return reply({ message: "Session required" }, 401);
    const url = new URL(req.url, `http://127.0.0.1:${apiPort}`);
    if (url.pathname === "/api/me") return reply({ user: { email: "fixture@example.invalid", emailVerifiedAt: "2026-11-17T00:00:00Z", hasLocalPassword: false } });
    if (!url.pathname.startsWith("/api/inventory/items")) return reply({}, 404);
    if (req.method === "GET") {
      const page = Number(url.searchParams.get("page") || 1);
      if (url.pathname.endsWith("/movements")) {
        const rows = movements.filter(row => row.itemId === url.pathname.split("/")[4]).toReversed();
        return reply({ result: { movements: rows.slice((page - 1) * 24, page * 24), total: rows.length, page } });
      }
      if (failList) return reply({ message: "Fixture list unavailable" }, 503);
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const rows = items.filter(item => `${item.name} ${item.sku}`.toLowerCase().includes(q));
      return reply({ result: { items: rows.slice((page - 1) * 24, page * 24), total: rows.length, page } });
    }
    let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return reply({}, 413); }
    const body = JSON.parse(raw);
    if (url.pathname === "/api/inventory/items") {
      const existing = items.find(item => item.id === body.id);
      if (existing) return reply({ result: existing });
      if (items.some(item => item.sku === body.sku)) return reply({ message: "SKU ya utilizado" }, 409);
      const item = { ...body, stock: 0 }; items.unshift(item); return reply({ result: item });
    }
    posts.push(body);
    const itemId = url.pathname.split("/")[4], item = items.find(row => row.id === itemId);
    if (!item) return reply({}, 404);
    const existing = movements.find(row => row.itemId === itemId && row.key === body.key);
    if (existing) return reply({ result: existing });
    const stock = body.type === "ADJUSTMENT" ? body.quantity : item.stock + (body.type === "IN" ? body.quantity : -body.quantity);
    if (stock < 0) return reply({ message: "El movimiento excede las existencias" }, 409);
    const movement = { ...body, itemId, id: randomUUID(), previousStock: item.stock, resultingStock: stock, createdAt: new Date().toISOString() };
    movements.push(movement); item.stock = stock;
    if (loseReply) { loseReply = false; return reply({ message: "Respuesta perdida simulada. Reintenta con los mismos datos." }, 503); }
    return reply({ result: movement });
  });
  api.listen(apiPort, "127.0.0.1"); await once(api, "listening");
  app = require("next")({ dir: folder, dev: true, webpack: true, hostname: "localhost", port: uiPort });
  await app.prepare();
  ui = http.createServer(app.getRequestHandler()); ui.listen(uiPort, "127.0.0.1"); await once(ui, "listening");

  const executable = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  assert.ok(executable, "CHROME_OR_EDGE_REQUIRED");
  const profile = path.join(folder, "browser-profile");
  chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  await poll(() => existsSync(path.join(profile, "DevToolsActivePort")));
  const port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await once(socket, "open");
  socket.addEventListener("message", event => {
    const value = JSON.parse(event.data);
    if (value.id) { const entry = pending.get(value.id); pending.delete(value.id); if (value.error) entry.reject(new Error(value.error.message)); else entry.resolve(value.result); }
    if (value.method === "Runtime.exceptionThrown") browserErrors.push(value.params.exceptionDetails.text);
  });
  await command("Page.enable"); await command("Runtime.enable"); await command("Network.enable");
  await command("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'inventory-browser-owner',email:'fixture@example.invalid',name:'Inventario de prueba'}}))" });
  await command("Network.setCookie", { name: "catalogo_session", value: "inventory-browser-fixture", url: base, httpOnly: true, sameSite: "Lax" });
  stage = "EMPTY_AND_CREATE";
  await command("Page.navigate", { url: `${base}/dashboard/inventario` });
  await poll(async () => (await text()).includes("No hay productos para esta búsqueda"), 60000);
  for (const [name, sku] of [["Producto de prueba A", "ITEM-A"], ["Producto de prueba B", "ITEM-B"]]) {
    await fill("Nombre", name); await fill("SKU / código", sku); await click("Crear producto");
    await poll(async () => (await text()).includes(`SKU: ${sku}`));
  }
  pass(stage);
  stage = "LOST_REPLY_SWITCH_AND_RETRY";
  await click("Movimientos de Producto de prueba A");
  await poll(() => evaluate("document.activeElement.id==='movements'"));
  await fill("Cantidad", "5"); await fill("Motivo", "Entrada de prueba"); loseReply = true;
  await click("Registrar movimiento"); await poll(async () => (await text()).includes("Respuesta perdida simulada"));
  await click("Movimientos de Producto de prueba B");
  assert.ok(await evaluate("(()=>{const fields=document.querySelectorAll('section[aria-labelledby=movements] input');return fields[0].value==='1'&&fields[1].value==='';})()"), "draft must not leak to another product");
  await click("Movimientos de Producto de prueba A");
  await click("Registrar movimiento");
  await poll(async () => (await text()).includes("Movimiento registrado."));
  assert.equal(posts.length, 2); assert.equal(posts[0].key, posts[1].key);
  assert.equal(items.find(item => item.sku === "ITEM-A").stock, 5); assert.equal(movements.length, 1); pass(stage);
  stage = "NEGATIVE_STOCK_VISIBLE_ERROR_AND_ZERO_ADJUSTMENT";
  await fill("Tipo", "OUT"); await fill("Cantidad", "6"); await fill("Motivo", "Salida de prueba"); await click("Registrar movimiento");
  await poll(async () => (await text()).includes("El movimiento excede las existencias"));
  assert.ok(await evaluate("document.querySelector('section[aria-labelledby=movements] [role=alert]')?.textContent.includes('excede')"));
  await fill("Tipo", "ADJUSTMENT"); await fill("Existencia final contada", "0"); await fill("Motivo", "Conteo de prueba"); await click("Registrar movimiento");
  await poll(async () => (await text()).includes("Existencias al consultar: 0")); pass(stage);
  stage = "DOUBLE_SUBMISSION";
  await fill("Tipo", "IN"); await fill("Cantidad", "2"); await fill("Motivo", "Doble envío de prueba");
  const beforeDouble = posts.length;
  await evaluate("(()=>{const form=document.querySelector('section[aria-labelledby=movements] form');form.requestSubmit();form.requestSubmit()})()");
  await poll(async () => (await text()).includes("Existencias al consultar: 2"));
  assert.equal(posts.length, beforeDouble + 1); pass(stage);
  stage = "SEARCH_PAGINATION_AND_RECOVERY";
  for (let index = 0; index < 25; index++) fixtureItem(`Paginado ${index}`, `PAGE-${index}`);
  await fill("Buscar por nombre o SKU", "paginado"); await click("Buscar"); await poll(async () => (await text()).includes("25 productos"));
  assert.equal(await evaluate("document.querySelectorAll('article').length"), 24);
  await click("Siguiente"); await poll(() => evaluate("document.querySelectorAll('article').length===1"));
  await click("Anterior"); await poll(() => evaluate("document.querySelectorAll('article').length===24"));
  failList = true; await fill("Buscar por nombre o SKU", "item"); await click("Buscar");
  await poll(async () => (await text()).includes("Fixture list unavailable"));
  failList = false; await click("Recargar datos"); await poll(() => evaluate("document.querySelectorAll('article').length===2")); pass(stage);
  stage = "MOBILE_AND_DESKTOP_LAYOUT";
  for (const width of [320, 390, 1280]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), `Overflow at ${width}px`);
    assert.ok(await evaluate("[...document.querySelectorAll('button')].filter(e=>['Anterior','Siguiente','Anteriores','Más movimientos'].includes(e.textContent)).every(e=>{const range=document.createRange();range.selectNodeContents(e);return range.getClientRects().length===1})"), `Pagination labels wrap inside words at ${width}px`);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await fs.writeFile(path.join(folder, `inventory-${width}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await evaluate("document.querySelector('section[aria-labelledby=new-item] input').focus()");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.ok(await evaluate("document.activeElement===document.querySelectorAll('section[aria-labelledby=new-item] input')[1]&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2"));
  pass(stage);
  stage = "SESSION_EXPIRATION";
  expired = true; await fill("Nombre", "Expired fixture"); await fill("SKU / código", "EXPIRED"); await click("Crear producto");
  await poll(async () => (await text()).includes("Tu sesión expiró")); pass(stage);
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ passed: passed.length, productionAccess: false, simulatedApi: true, sourceCopy: folder, bundler: "webpack", configOverride: false }));
} catch (error) {
  console.error(`FAIL ${stage}: ${error instanceof Error ? error.message : "ERROR"}`); process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) await command("Browser.close").catch(() => {});
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill(); await Promise.race([once(chrome, "exit"), wait(2000)]);
  }
  if (ui) { ui.closeAllConnections(); await Promise.race([new Promise(resolve => ui.close(resolve)), wait(2000)]); }
  if (api) { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
  await Promise.race([app?.close(), wait(5000)]);
  process.exit(process.exitCode ?? 0);
}
