import assert from "node:assert/strict";
import { cardFixture, verifyPublicCards } from "./public-product-card-checks.mjs";
import { themeFixture, verifyPublicThemes } from "./public-theme-checks.mjs";
import { verifyPaletteSettings } from "./palette-settings-checks.mjs";
const publicCards = process.argv.includes("--public-cards");
const publicThemes = process.argv.includes("--public-themes");
const paletteSettings = process.argv.includes("--palette-settings");
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vitrinaya-ui-pilot-"));
const base = "http://127.0.0.1:4338";
const templates = ["TECH", "FASHION", "BEAUTY", "GLAMOUR", "EDITORIAL", "GRID", "BOUTIQUE"];
const catalog = { id: "local-catalog", publicId: "demo", name: "Catálogo local", slug: "demo", active: true, archivedAt: null,
  description: "Prueba visual local", logoUrl: null, whatsappPhone: null, whatsappMessage: null,
  phone: null, address: null, businessHours: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, email: null, mapUrl: null,
  categories: [], products: [{ id: "p1", name: "Producto local", slug: "producto", description: "Prueba local", brand: null,
    model: null, categoryId: null, category: null, price: 1000, regularPrice: null, discountPercent: null, saleEndsAt: null, images: [] }] };
const privateProduct = { ...catalog.products[0], catalogId: catalog.id, sku: "LOCAL-1", stock: 4, active: true, needsCompletion: false, salePrice: null, saleStartsAt: null };
const categoryFixture = { id: "local-category", name: "Categoría local", slug: "categoria", imageUrl: null, position: 0 };
let settingsCatalog = { ...catalog, template: "FASHION", themePreset: null };
const paletteSaves = [];
const handlePublic = (req, res) => {
  const id = req.url.split("/").pop();
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ catalog: publicThemes ? themeFixture(catalog, id) : publicCards ? cardFixture(catalog, id) : { ...catalog, publicId: id, template: templates.includes(id) ? id : "TECH" } }));
};
const secureApi = process.argv.includes("--https-api");
let api, caPath;
if (secureApi) {
  const pem = execFileSync("C:/Program Files/Git/usr/bin/openssl.exe", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "-", "-out", "-", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const cert = pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
  const key = pem.match(/-----BEGIN PRIVATE KEY-----[^]*?-----END PRIVATE KEY-----/)?.[0];
  assert.ok(cert && key, "LOCAL_CERTIFICATE_REQUIRED");
  caPath = path.join(folder, "localhost-public-cert.pem");
  fs.writeFileSync(caPath, cert);
  api = https.createServer({ key, cert }, handlePublic);
} else api = http.createServer(handlePublic);
let next, chrome, socket, seq = 0;
let cancelNativeDialogs = false;
const pending = new Map();
const errors = [];
const mutations = [];
const result = { keyboard: [], publicStyles: [], backend: "simulated loopback", externalRequests: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn) {
  for (let i = 0; i < 120; i++) { if (await fn()) return; await pause(100); }
  throw new Error("LOCAL_BROWSER_TIMEOUT");
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
}
function interception(method, params) {
  void command(method, params).catch(error => {
    if (!/Invalid InterceptionId|LOCAL_BROWSER_CLOSED/.test(error.message)) errors.push("LOCAL_INTERCEPTION_FAILED");
  });
}
async function evaluate(expression) {
  const data = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (data.exceptionDetails) throw new Error("BROWSER_EVALUATION_FAILED: " + data.exceptionDetails.text);
  return data.result.value;
}
async function key(key, modifiers = 0) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, modifiers, text: key === "Enter" ? "\r" : undefined, windowsVirtualKeyCode: key === "Tab" ? 9 : key === "Escape" ? 27 : 13 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers });
}
async function openDialog(label, role, title) {
  console.log("Opening " + role);
  await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').focus()`);
  await key("Enter");
  await poll(() => evaluate(`Boolean(document.querySelector('[role="${role}"]'))`));
  assert.equal(await evaluate(`document.getElementById(document.querySelector('[role="${role}"]').getAttribute('aria-labelledby')).textContent`), title);
}
async function checkTrap(role) {
  for (let i = 0; i < 8; i++) {
    await key("Tab");
    assert.ok(await evaluate(`document.querySelector('[role="${role}"]').contains(document.activeElement)`), "Tab stays inside dialog");
  }
  for (let i = 0; i < 5; i++) {
    await key("Tab", 8);
    assert.ok(await evaluate(`document.querySelector('[role="${role}"]').contains(document.activeElement)`), "Shift+Tab stays inside dialog");
  }
}
async function closeDialog(label, role) {
  await key("Escape");
  await poll(() => evaluate(`!document.querySelector('[role="${role}"]')`));
  await poll(() => evaluate(`document.activeElement.getAttribute('aria-label')===${JSON.stringify(label)}`));
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), label);
}
async function fill(selector, value) {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function clickText(text) {
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
}
async function fits(label) {
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), label + " document overflow");
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().height>0).every(b=>['36px','44px','48px'].includes(getComputedStyle(b).minHeight))`), label + " unified button sizes");
}

try {
  api.listen(4317, "127.0.0.1"); await once(api, "listening");
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "4338"], {
    env: { ...process.env, NEXT_PUBLIC_CATALOG_API_URL: `${secureApi ? "https" : "http"}://127.0.0.1:4317/api`, ...(caPath ? { NODE_EXTRA_CA_CERTS: caPath } : {}) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  next.stdout.resume(); next.stderr.resume();
  await poll(async () => { try { return (await fetch(base + "/login", { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } });
  const executable = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(f => fs.existsSync(f));
  assert.ok(executable, "LOCAL_CHROMIUM_REQUIRED");
  chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${path.join(folder, "profile")}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const activePort = path.join(folder, "profile", "DevToolsActivePort");
  await poll(() => fs.existsSync(activePort));
  const port = Number(fs.readFileSync(activePort, "utf8").split(/\r?\n/)[0]);
  let target;
  await poll(async () => { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === "page"); return Boolean(target); });
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, "open");
  socket.addEventListener("close", () => {
    for (const item of pending.values()) item.reject(new Error("LOCAL_BROWSER_CLOSED"));
    pending.clear();
  });
  socket.addEventListener("message", event => {
    const m = JSON.parse(event.data);
    if (m.id) { const item = pending.get(m.id); pending.delete(m.id); if (m.error) item?.reject(new Error(m.error.message)); else item?.resolve(m.result); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
    if (m.method === "Page.javascriptDialogOpening" && cancelNativeDialogs) void command("Page.handleJavaScriptDialog", { accept: false });
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        result.externalRequests.push(url.hostname);
        interception("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      } else if (url.pathname.startsWith("/card-test-")) {
        const portrait = url.pathname.includes("portrait");
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+(portrait?180:400)+'" height="'+(portrait?400:180)+'"><rect width="100%" height="100%" fill="#e8f3ef"/><circle cx="90" cy="90" r="60" fill="#0F6B57"/></svg>';
        interception("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{name:"Content-Type",value:"image/svg+xml"}], body:Buffer.from(svg).toString("base64") });
      } else if (publicThemes && url.pathname.includes("/reviews")) {
        interception("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:base}], body: Buffer.from(JSON.stringify({ reviews: [], reviewCount: 0, averageRating: null })).toString("base64") });
      } else if (url.pathname.startsWith("/api/public/catalogs/")) {
        const id = url.pathname.split("/").pop();
        interception("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base }], body: Buffer.from(JSON.stringify({ catalog: publicThemes ? themeFixture(catalog, id) : publicCards ? cardFixture(catalog, id) : { ...catalog, publicId: id, template: templates.includes(id) ? id : "TECH" } })).toString("base64") });
      } else if (url.pathname.startsWith("/api/backend/")) {
        if (request.method !== "GET") mutations.push(request.method);
        let body;
        if (url.pathname.endsWith("/me")) body = { user: { email: "test@example.invalid", emailVerifiedAt: "2026-01-01", hasLocalPassword: true } };
        else if (url.pathname.includes("/photos/pending")) body = { products: [{ ...privateProduct, needsCompletion: true, active: false }], count: 1, page: 1, pages: 1 };
        else if (url.pathname.includes("/products/catalog/") && url.pathname.endsWith("/list")) body = { products: [privateProduct], page: 1, pageSize: 24, totalProducts: 1, totalFiltered: 1, totalPages: 1, needsCompletionCount: 1 };
        else if (url.pathname.includes("/categories/catalog/")) body = { categories: [categoryFixture] };
        else if (url.pathname.includes("/catalogs/")) {
          if (paletteSettings && request.method === "PUT") {
            const patch = JSON.parse(request.postData);
            paletteSaves.push(patch);
            settingsCatalog = { ...settingsCatalog, ...patch };
            body = { success: true, message: "Cambios guardados." };
          } else body = { catalog: paletteSettings ? settingsCatalog : { ...catalog, template: "TECH" } };
        }
        else if (url.pathname.includes("/reviews/")) body = { reviews: [] };
        else if (url.pathname.includes("/orders/")) body = { orders: [] };
        else body = { catalogs: [{ ...catalog, template: "TECH" }] };
        interception("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
      } else interception("Fetch.continueRequest", { requestId });
    }
  });
  await command("Page.enable"); await command("Runtime.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  if (paletteSettings) {
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'local-user',email:'test@example.invalid',name:'Prueba local'}}));` });
    result.paletteSettings = await verifyPaletteSettings({ command, evaluate, poll, pause, fill, clickText, base, folder, saves: paletteSaves });
  }
  if (!publicCards && !publicThemes && !paletteSettings) {
  await command("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'local-user',email:'test@example.invalid',name:'Prueba local'}}));` });
  await command("Page.navigate", { url: base + "/dashboard" });
  await poll(() => evaluate(`Boolean(document.querySelector('button[aria-label="Archivar Catálogo local"]'))`));
  console.log("Local dashboard ready; checking keyboard and focus.");
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const [label, role, title] of [["Archivar Catálogo local", "dialog", "Archivar catálogo"], ["Eliminar Catálogo local permanentemente", "alertdialog", "Eliminar catálogo"]]) {
      await openDialog(label, role, title);
      assert.ok(await evaluate(`(()=>{const r=document.querySelector('[role="${role}"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`));
      await checkTrap(role);
      await closeDialog(label, role);
      result.keyboard.push({ width, role, escape: true, focusTrap: true, focusReturned: true });
    }
  }
  assert.deepEqual(mutations, [], "Opening/cancelling never mutates data");
  if (process.argv.includes("--panel")) {
    result.panel = [];
    for (const width of [320, 390, 1024, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await command("Page.navigate", { url: base + "/dashboard" });
      await poll(() => evaluate(`Boolean(document.querySelector('button[aria-label="Archivar Catálogo local"]'))`));
      await fits("dashboard " + width);
      await command("Page.navigate", { url: base + "/dashboard/catalogos/" + catalog.id });
      await poll(() => evaluate(`Boolean(document.querySelector('input[placeholder="Ej. Lámpara de mesa"]'))&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Eliminar')`));
      const name = 'input[placeholder="Ej. Lámpara de mesa"]';
      const category = 'input[aria-label="Nombre de la nueva categoría"]';
      await fill(name, "Borrador sin guardar");
      await fill(category, "Categoría sin guardar");
      await fill('textarea[maxlength="2000"]', "Descripción sin guardar");
      await evaluate(`window.__panelDraftName=document.querySelector(${JSON.stringify(name)});window.__panelDraftDescription=document.querySelector('textarea[maxlength="2000"]');void 0`);
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Eliminar').focus()`);
      await key("Enter");
      await poll(() => evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`));
      await checkTrap("alertdialog"); await key("Escape");
      await poll(() => evaluate(`!document.querySelector('[role="alertdialog"]')`));
      await openDialog("Eliminar categoría Categoría local", "alertdialog", "Eliminar categoría");
      await checkTrap("alertdialog");
      await closeDialog("Eliminar categoría Categoría local", "alertdialog");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(name)}).value`), "Borrador sin guardar");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(category)}).value`), "Categoría sin guardar");
      assert.ok(await evaluate(`window.__panelDraftName===document.querySelector(${JSON.stringify(name)})&&window.__panelDraftDescription.value==='Descripción sin guardar'`));
      await fits("workspace " + width);
      await clickText("Importar Excel");
      await poll(() => evaluate(`document.getElementById('product-import-title')?.getBoundingClientRect().height>0`));
      await fits("import " + width);
      await clickText("Cerrar importación");
      await clickText("Cargar varias fotos");
      await poll(() => evaluate(`document.querySelector('input[maxLength="150"]')!==null&&document.body.textContent.includes('Nombre revisado')`));
      await fits("photos " + width);
      const photoName = 'section[aria-labelledby="photo-title"] input[maxlength="150"]';
      await fill(photoName, "Borrador de foto");
      cancelNativeDialogs = true;
      await clickText("Cerrar");
      cancelNativeDialogs = false;
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(photoName)}).value`), "Borrador de foto");
      await fill(photoName, privateProduct.name);
      await clickText("Cerrar");
      await poll(() => evaluate(`!document.body.textContent.includes('Nombre revisado')`));
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(name)}).value`), "Borrador sin guardar");
      assert.ok(await evaluate(`window.__panelDraftName===document.querySelector(${JSON.stringify(name)})&&window.__panelDraftDescription.value==='Descripción sin guardar'`));
      await clickText("Tienda y diseño");
      await poll(() => evaluate(`Boolean(document.querySelector('input[pattern="[0-9][0-9. -]*"]'))`));
      await fits("settings " + width);
      await command("Page.navigate", { url: base + "/dashboard/catalogos/nuevo" });
      await poll(() => evaluate(`Boolean(document.querySelector('input[placeholder="Colección de temporada"]'))`));
      await fits("new catalog " + width);
      result.panel.push({ width, overflow: false, productAndCategoryDraftsPreserved: true, photoDraftPreserved: true });
    }
    assert.deepEqual(mutations, [], "Panel checks never submit forms");
  }
  }
  assert.ok(!process.argv.includes("--baseline-css"), "Use --public-cards --card-baseline FILE for visual invariants");
  if (publicCards) result.publicCards = await verifyPublicCards({ command, evaluate, poll, pause: ms => pause(ms), base, folder });
  if (publicThemes) result.publicThemes = await verifyPublicThemes({ command, evaluate, poll, pause, base, folder });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ success: true, ...result }, null, 2));
} catch (error) {
  if (paletteSettings && socket?.readyState === WebSocket.OPEN) result.paletteDebug = { saves: paletteSaves.length, state: await evaluate(`({active:document.activeElement?.outerHTML.slice(0,350),checked:[...document.querySelectorAll('input[name="themePreset"]')].filter(e=>e.checked).map(e=>e.value),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),submitDisabled:document.querySelector('form button[type="submit"]')?.disabled})`) };
  if (socket?.readyState === WebSocket.OPEN) {
    result.debug = await evaluate(`({focused:document.activeElement?.getAttribute('aria-label'),dialogs:[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map(e=>({role:e.getAttribute('role'),title:e.textContent.slice(0,100)})),url:location.pathname})`);
  }
  result.browserErrors = errors;
  console.error(JSON.stringify({ success: false, reason: error.message.slice(0, 400), ...result }));
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command("Browser.close"); } catch {} socket.close(); }
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (next && next.exitCode === null) { next.kill(); await once(next, "exit"); }
  api.closeAllConnections(); api.close();
}
