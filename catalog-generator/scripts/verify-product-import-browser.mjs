import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { createProductImportTemplate } = require("../lib/product-import/template.ts");
if (previous) Module._extensions[".ts"] = previous; else delete Module._extensions[".ts"];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "catalogo-import-browser-"));
const catalogId = "11111111-1111-4111-8111-111111111111";
const catalog = { id: catalogId, publicId: catalogId, name: "Catálogo ficticio", slug: "prueba-local", active: true, archivedAt: null, template: "TECH", description: null, logoUrl: null };
const products = new Map();
const product = (name, sku) => ({ id: `product-${sku}`, catalogId, name, slug: sku.toLowerCase(), sku, price: 100, stock: 0, active: true, category: null, categoryId: null, description: null, brand: null, model: null, salePrice: null, saleStartsAt: null, saleEndsAt: null, images: [] });
products.set("EXISTENTE", product("Existente", "EXISTENTE"));
let mode = "normal", seen = 0, round = 0, confirms = 0, expectedToken, previewCalls = [], confirmBodies = [];
let next, chrome, socket, stage = "startup", api;
const browserErrors = [], apiReads = [];
const importResponses = [];
const fileChoosers = [];
const summary = { passed: false, productionAccess: false, realDatabase: false, scenarios: [] };
const step = value => { stage = value; console.log("BROWSER_STAGE " + value); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(work, timeout = 15_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await work()) return; await wait(50); }
  throw new Error("CHECK_TIMEOUT");
}
function fixture(name, count, numericSku = false) {
  const files = unzipSync(createProductImportTemplate());
  let xml = strFromU8(files["xl/worksheets/sheet1.xml"]).replace(/<row r="([0-9]+)">[^]*?<\/row>/g, (value, row) => Number(row) === 1 ? value : "");
  const text = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  let rows = "";
  for (let i = 0; i < count; i++) { const row = i + 2; rows += `<row r="${row}">${text(`A${row}`, `Producto ${i}`)}${text(`B${row}`, i === 0 && name === "mixed" ? "EXISTENTE" : `${name}-${i}`)}<c r="G${row}"><v>200</v></c></row>`; }
  if (numericSku) { const row = count + 2; rows += `<row r="${row}">${text(`A${row}`, "SKU numérico")}<c r="B${row}"><v>123</v></c><c r="G${row}"><v>100</v></c></row>`; }
  xml = xml.replace("</sheetData>", rows + "</sheetData>"); files["xl/worksheets/sheet1.xml"] = strToU8(xml);
  const target = path.join(folder, `${name}.xlsx`); fs.writeFileSync(target, zipSync(files)); return target;
}
const files = { mixed: fixture("mixed", 2, true), stop: fixture("stop", 101), lost: fixture("lost", 101), rate: fixture("rate", 2), auth: fixture("auth", 2) };
const pending = new Map(); let sequence = 0;
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP_TIMEOUT")); }, 5000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("BROWSER_EVALUATION_FAILED");
  return result.result.value;
}
const click = label => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)return false;button.click();return true})()`);
const counts = () => evaluate(`Object.fromEntries([...document.querySelectorAll('#product-import-panel dl>div')].map(e=>[e.querySelector('dt').textContent,Number(e.querySelector('dd').textContent)]))`);
const status = () => evaluate(`document.querySelector('#product-import-panel [role="status"]')?.textContent||''`);
async function select(target) {
  const document = await command("DOM.getDocument");
  const node = await command("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#product-import-file" });
  await command("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [target] });
}
function reset(nextMode) { mode = nextMode; confirms = 0; previewCalls = []; confirmBodies = []; }

try {
  // Preserve the production HTTPS guard. Generate a disposable localhost key in memory;
  // only its PUBLIC certificate is written, trusted by this child Next process alone.
  const pem = execFileSync("C:/Program Files/Git/usr/bin/openssl.exe", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "-", "-out", "-", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const certificate = pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
  const key = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];
  assert.ok(certificate && key);
  const caPath = path.join(folder, "localhost-public-cert.pem"); fs.writeFileSync(caPath, certificate);
  api = https.createServer({ key, cert: certificate }, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const reply = (value, code = 200) => { res.statusCode = code; res.end(JSON.stringify(value)); };
    if (req.method === "GET") {
      apiReads.push(req.url);
      if (mode === "auth" && confirms > 0) return reply({ success: false, error: "AUTH_REQUIRED" }, 401);
      if (req.url === "/api/catalogs") return reply({ catalogs: [catalog] });
      if (req.url === `/api/catalogs/${catalogId}`) return reply({ catalog });
      if (req.url === `/api/categories/catalog/${catalogId}`) return reply({ categories: [] });
      if (req.url === `/api/products/catalog/${catalogId}`) return reply({ products: [...products.values()] });
      if (req.url.startsWith("/api/product-images/product/")) return reply({ images: [] });
    }
    if (req.method !== "POST" || !req.url.startsWith(`/api/products/catalog/${catalogId}/import/`)) return reply({ success: false }, 404);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(body.rows.length <= 50); assert.equal(Object.hasOwn(body, "file"), false);
    if (req.url.endsWith("/preview")) {
      if (!body.previewToken) { seen = 0; round++; expectedToken = undefined; }
      assert.equal(body.previewToken, expectedToken); seen += body.rows.length;
      expectedToken = `preview-${round}-${seen}`; previewCalls.push(body.rows.length);
      return reply({ success: true, requestId: `preview-${round}-${seen}`, rows: body.rows.map(row => ({ rowNumber: row.rowNumber, action: products.has(row.sku) ? "update" : "create", code: "MATCH", reason: products.has(row.sku) ? "Actualizar por SKU" : "Producto nuevo" })), previewToken: expectedToken, ready: seen === body.totalRows, invalidatedRows: [] });
    }
    confirms++; confirmBodies.push(body.rows.map(row => row.rowNumber));
    assert.equal(body.previewToken, expectedToken);
    if (mode === "auth") return reply({ success: false, error: "AUTH_REQUIRED", requestId: "auth-local" }, 401);
    if (mode === "rate" && confirms === 1) return reply({ success: false, error: "IMPORT_BUSY", requestId: "rate-local" }, 429);
    const rows = body.rows.map(row => { const action = products.has(row.sku) ? "update" : "create"; products.set(row.sku, { ...product(row.name, row.sku), price: row.price }); return { rowNumber: row.rowNumber, action, code: "SAVED", reason: "Guardado" }; });
    if (mode === "lost") { req.socket.destroy(); return; }
    if (mode === "stop") await wait(2000);
    reply({ success: true, requestId: `confirmed-${confirms}`, rows });
  });
  api.listen(4329, "127.0.0.1"); await once(api, "listening");
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "4328"], { cwd: root, env: { ...process.env, CATALOG_API_URL: "https://127.0.0.1:4329/api", NEXT_PUBLIC_CATALOG_API_URL: "https://127.0.0.1:4329/api", NODE_EXTRA_CA_CERTS: caPath }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  next.stdout.resume(); next.stderr.resume();
  await poll(async () => { try { return (await fetch("http://127.0.0.1:4328/login", { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } });
  step("browser-start");
  const executable = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(name => fs.existsSync(name));
  assert.ok(executable, "LOCAL_CHROMIUM_REQUIRED");
  chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${path.join(folder, "profile")}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let target;
  const activePort = path.join(folder, "profile", "DevToolsActivePort");
  await poll(() => fs.existsSync(activePort));
  const debugPort = Number(fs.readFileSync(activePort, "utf8").split(/\r?\n/)[0]);
  assert.ok(debugPort > 0 && debugPort < 65536);
  await poll(async () => { try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find(page => page.type === "page"); return Boolean(target); } catch { return false; } });
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, "open");
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(new Error("CDP_FAILED")); else item?.resolve(message.result); } else if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description?.split("\n")[0] ?? message.params.exceptionDetails.text); else if (message.method === "Network.responseReceived" && message.params.response.url.includes("/import/")) importResponses.push({ requestId: message.params.requestId, status: message.params.response.status }); });
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); if (message.method === "Page.fileChooserOpened") fileChoosers.push(message.params); });
  await command("Page.enable"); await command("Runtime.enable"); await command("Network.enable");
  await command("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.hostname==='localhost')localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'test-user',email:'test@example.invalid',name:null}}))` });
  await command("Page.navigate", { url: "http://localhost:4328/" });
  step("workspace");
  await poll(() => evaluate(`Boolean(document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]'))`));
  await evaluate(`document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]').click()`);
  await poll(() => evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Importar Excel')`));
  await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Ej. Lámpara de mesa"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Borrador conservado');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  assert.equal(await click("Importar Excel"), true);
  await poll(() => evaluate(`document.activeElement?.id==='product-import-title'`));
  assert.ok(await evaluate(`Boolean(document.querySelector('a[download="plantilla-productos.xlsx"]'))`));
  step("native-file-chooser");
  await command("Page.setInterceptFileChooserDialog", { enabled: true });
  const picker = await evaluate(`(()=>{const input=document.getElementById('product-import-file'),label=input.labels[0];label.scrollIntoView({block:'center'});const r=label.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,rect:{left:r.left,top:r.top,width:r.width,height:r.height},disabled:input.disabled,hit:label.contains(document.elementFromPoint(x,y)),label:label.textContent,accept:input.accept}})()`);
  summary.pickerGeometry = picker;
  assert.equal(picker.disabled, false);
  assert.equal(picker.hit, true, "Visible label must receive pointer events without an overlay");
  assert.ok(picker.rect.height >= 44);
  assert.equal(picker.label, "Seleccionar archivo Excel");
  assert.equal(picker.accept, ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: picker.x, y: picker.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: picker.x, y: picker.y, button: "left", clickCount: 1 });
  await poll(() => fileChoosers.length === 1);
  await evaluate(`document.querySelector('a[download="plantilla-productos.xlsx"]').focus()`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate(`document.activeElement?.id`), "product-import-file");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('label[for="product-import-file"]')).outlineStyle`), "solid");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await poll(() => fileChoosers.length === 2);
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobilePicker = await evaluate(`(()=>{const label=document.querySelector('label[for="product-import-file"]');label.scrollIntoView({block:'center'});const r=label.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,rect:{left:r.left,top:r.top,width:r.width,height:r.height},hit:label.contains(document.elementFromPoint(x,y)),fits:r.left>=0&&r.right<=innerWidth}})()`);
  summary.mobilePickerGeometry = mobilePicker;
  assert.equal(mobilePicker.hit, true);
  assert.equal(mobilePicker.fits, true);
  assert.ok(mobilePicker.rect.height >= 44);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: mobilePicker.x, y: mobilePicker.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: mobilePicker.x, y: mobilePicker.y, button: "left", clickCount: 1 });
  await poll(() => fileChoosers.length === 3);
  await command("Emulation.clearDeviceMetricsOverride");
  await command("Page.setInterceptFileChooserDialog", { enabled: false });
  summary.scenarios.push("visible file label opens picker by pointer and Tab+Space; focus outline, 44px target, correct accept and no overlay");
  step("real-reader-and-mixed-preview"); await select(files.mixed);
  await poll(async () => (await status()).includes("Lista para revisar"));
  let report = await counts(); assert.equal(report["Nuevas (vista previa)"], 1); assert.equal(report["Actualizar (vista previa)"], 1); assert.equal(report["Filas con error"], 1);
  assert.equal(await evaluate(`document.activeElement?.textContent`), "Revisión y reporte");
  assert.equal(await click("Importar 2 productos"), true);
  await poll(async () => (await status()).includes("Reporte final"));
  report = await counts(); assert.equal(report.Creadas, 1); assert.equal(report.Actualizadas, 1); assert.equal(report["Filas con error"], 1);
  assert.deepEqual(confirmBodies, [[2, 3]]);
  await poll(() => evaluate(`[...document.querySelectorAll('span')].some(e=>e.textContent.trim()==='2 en total')`));
  await poll(() => evaluate(`!document.querySelector('#product-import-panel button')?.disabled`));
  assert.equal(await evaluate(`document.querySelector('input[placeholder="Ej. Lámpara de mesa"]').value`), "Borrador conservado");
  assert.equal(await click("Cerrar importación"), true);
  assert.equal(await click("Importar Excel"), true);
  await poll(() => evaluate(`document.activeElement?.id==='product-import-title'`));
  assert.equal((await counts())["Filas con error"], 1);
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+1`));
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(os.tmpdir(), "catalogo-import-mobile.png"), Buffer.from(screenshot.data, "base64"));
  await command("Emulation.clearDeviceMetricsOverride");
  summary.scenarios.push("real browser worker, mixed preview, numeric SKU excluded, confirm, refresh, draft and focus");
  summary.scenarios.push("reopening preserves report and title focus; 390px viewport has no document overflow");
  step("stop-after-current-batch"); reset("stop"); await select(files.stop); await poll(async () => (await status()).includes("Lista para revisar"));
  assert.deepEqual(previewCalls, [50, 50, 1]); assert.equal(await click("Importar 101 productos"), true);
  await poll(async () => confirms === 1 && (await status()).includes("Importando productos"));
  assert.equal(await evaluate(`[...document.querySelectorAll('#product-import-panel button')].find(b=>b.textContent==='Cerrar importación').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('fieldset').disabled`), true);
  assert.equal(await click("Detener después del lote actual"), true);
  await poll(async () => (await status()).includes("Operación detenida"));
  report = await counts(); assert.equal(report.Creadas, 50); assert.equal(report["No procesadas"], 51); assert.equal(confirms, 1);
  assert.equal(await evaluate(`document.querySelectorAll('#product-import-panel tbody tr').length`), 25);
  assert.equal(await click("Siguiente"), true); await poll(() => evaluate(`document.activeElement?.textContent.includes('Página 2')`));
  summary.scenarios.push("three chained preview batches, stop, write lock UI, pagination");
  step("lost-write-response"); reset("lost"); await select(files.lost); await poll(async () => (await status()).includes("Lista para revisar")); await click("Importar 101 productos");
  await poll(async () => (await counts())["Resultado desconocido"] === 50);
  report = await counts(); assert.equal(report["No procesadas"], 51); assert.equal(confirms, 1);
  summary.scenarios.push("lost upstream response: unknown current batch, no automatic replay");
  step("controlled-429"); reset("rate"); await select(files.rate); await poll(async () => (await status()).includes("Lista para revisar")); await click("Importar 2 productos");
  await poll(() => evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Reintentar lote rechazado'))`));
  assert.equal(confirms, 1); await poll(() => evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Reintentar lote rechazado')?.disabled===false`));
  assert.equal(confirms, 1); await click("Reintentar lote rechazado"); await poll(async () => (await status()).includes("Reporte final")); assert.equal(confirms, 2);
  summary.scenarios.push("429 waits for explicit retry");
  step("expired-session"); reset("auth"); await select(files.auth); await poll(async () => (await status()).includes("Lista para revisar")); await click("Importar 2 productos");
  await poll(() => evaluate(`document.querySelector('#product-import-panel [role="alert"]')?.textContent.includes('sesión ha expirado')`));
  assert.equal(confirms, 1); assert.equal((await counts())["No procesadas"], 2);
  assert.ok(await evaluate(`Boolean([...document.querySelectorAll('#product-import-panel a')].find(a=>a.textContent==='Volver a iniciar sesión'))`));
  assert.equal(await evaluate(`document.getElementById('product-import-file').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('label[for="product-import-file"]').getAttribute('aria-disabled')`), "true");
  assert.equal(await evaluate(`document.getElementById('product-import-file-help').textContent`), "Vuelve a iniciar sesión para seleccionar un archivo.");
  assert.equal(await click("Cerrar importación"), true);
  assert.equal(await evaluate(`document.activeElement?.textContent`), "Importar Excel");
  summary.scenarios.push("401 retains report and close restores trigger focus");
  summary.passed = true;
} catch { summary.failedStage = stage; summary.browserErrors = browserErrors; summary.apiReadCount = apiReads.length; summary.previewBatches = previewCalls; if (socket?.readyState === WebSocket.OPEN) { try { summary.importResponses = []; for (const response of importResponses) { const data = await command("Network.getResponseBody", { requestId: response.requestId }); const body = JSON.parse(data.body); summary.importResponses.push({ status: response.status, success: body.success, errorCode: body.error, ready: body.ready, hasToken: Boolean(body.previewToken), rows: body.rows?.map(row=>({rowNumber:row.rowNumber,action:row.action})) }); } summary.visibleStatus = await status(); summary.visibleAlert = await evaluate(`document.querySelector('[role="alert"]')?.textContent||''`); summary.pageHeading = await evaluate(`document.querySelector('h1')?.textContent||''`); } catch { /* Browser may already be closed. */ } } process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command("Browser.close"); } catch { /* Chrome may close its connection before replying. */ } socket.close(); }
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (next && next.exitCode === null) { const exited = once(next, "exit", { signal: AbortSignal.timeout(3000) }).catch(() => {}); next.kill(); await exited; next.stdout.destroy(); next.stderr.destroy(); next.unref(); }
  if (api) { api.closeAllConnections(); api.close(); }
  fs.writeFileSync(path.join(os.tmpdir(), "catalogo-import-browser-results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
