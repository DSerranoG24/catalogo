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
let emailVerified = false, verificationRequests = 0, verificationConfirms = 0, passwordResets = 0, forgotRequests = 0;
let adminAllowed = true, adminBackendFailed = false;
let categoryPresent = true, categoryDeletes = 0, categoryDeleteFails = false;
const categoryId = "22222222-2222-4222-8222-222222222222";
const category = { id: categoryId, name: "Manos Libres", slug: "manos-libres", imageUrl: null, position: 0 };
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
  if (name === "identities") rows = `<row r="2">${text("B2", "001")}<c r="G2" t="inlineStr"><is><t>bad</t></is></c></row><row r="3"><c r="A3"><v>123</v></c>${text("B3", "002")}</row>`;
  xml = xml.replace("</sheetData>", rows + "</sheetData>"); files["xl/worksheets/sheet1.xml"] = strToU8(xml);
  const target = path.join(folder, `${name}.xlsx`); fs.writeFileSync(target, zipSync(files)); return target;
}
const files = { identities: fixture("identities", 0), allInvalid: fixture("all-invalid", 0, true), mixed: fixture("mixed", 2, true), stop: fixture("stop", 101), lost: fixture("lost", 101), rate: fixture("rate", 2), auth: fixture("auth", 2) };
const pending = new Map(); let sequence = 0;
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT: ${method}`)); }, 5000);
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
const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const selectControl = (label, value) => evaluate(`(()=>{const e=[...document.querySelectorAll('section[aria-busy] label')].find(e=>e.textContent.startsWith(${JSON.stringify(label)}))?.querySelector('select');if(!e)throw Error('SELECT_NOT_FOUND');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const rangeIs = text => evaluate(`[...document.querySelectorAll('nav[aria-label="Paginación de productos del panel"] p')].some(e=>e.textContent===${JSON.stringify(text)})`);
const counts = () => evaluate(`Object.fromEntries([...document.querySelectorAll('#product-import-panel dl>div')].map(e=>[e.querySelector('dt').textContent,Number(e.querySelector('dd').textContent)]))`);
const status = () => evaluate(`document.querySelector('#product-import-panel [role="status"]')?.textContent||''`);
const selectionLayout = () => evaluate(`(()=>{const label=document.querySelector('label[for="product-import-file"]'),state=document.getElementById('product-import-file-name')||document.querySelector('#product-import-panel [role="status"]');const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,centerY:r.top+r.height/2}};return {selector:rect(label),state:rect(state),text:state.textContent}})()`);
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
      if (req.url === "/api/admin/access") {
        if (adminBackendFailed) return reply({ success: false }, 503);
        return req.headers.authorization === "Bearer admin-test-session" && adminAllowed ? reply({ success: true }) : reply({ success: false, error: "ROUTE_NOT_FOUND" }, 404);
      }
      if (mode === "auth" && confirms > 0) return reply({ success: false, error: "AUTH_REQUIRED" }, 401);
      if (req.url === "/api/catalogs") return reply({ catalogs: [catalog] });
      if (req.url === "/api/me") return reply({ success: true, user: { id: "test-user", email: "owner@example.invalid", emailVerifiedAt: emailVerified ? "2026-10-25T12:00:00Z" : null, hasLocalPassword: true } });
      if (req.url === `/api/catalogs/${catalogId}`) return reply({ catalog });
      if (req.url === `/api/categories/catalog/${catalogId}`) return reply({ categories: categoryPresent ? [category] : [] });
      if (req.url === `/api/products/catalog/${catalogId}`) return reply({ products: [...products.values()] });
      const url = new URL(req.url, "https://localhost");
      if (url.pathname === `/api/products/catalog/${catalogId}/list`) {
        const params = url.searchParams, q = (params.get("q") ?? "").toLowerCase();
        let rows = [...products.values()].filter(p => (!q || [p.name, p.sku, p.brand, p.model].some(f => f?.toLowerCase().includes(q)))
          && (!params.has("category") || (params.get("category") === "none" ? p.categoryId === null : p.categoryId === params.get("category")))
          && (!params.has("status") || p.active === (params.get("status") === "active"))
          && (!params.has("stock") || (params.get("stock") === "in" ? p.stock > 0 : p.stock === 0)));
        const sort = params.get("sort") ?? "createdAt", direction = params.get("order") === "asc" ? 1 : -1;
        rows.sort((a, b) => {
          if (sort === "category" && Boolean(a.category) !== Boolean(b.category)) return a.category ? -1 : 1;
          const left = sort === "category" ? a.category?.name ?? "" : a[sort] ?? 0;
          const right = sort === "category" ? b.category?.name ?? "" : b[sort] ?? 0;
          const comparison = typeof left === "number" ? left - right : String(left).localeCompare(String(right));
          return comparison * direction || a.id.localeCompare(b.id);
        });
        const totalFiltered = rows.length, pageSize = Number(params.get("pageSize") ?? 24);
        const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize)), page = Math.min(Number(params.get("page") ?? 1), totalPages);
        if (q === "producto") await wait(700);
        return reply({ products: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalProducts: products.size, totalFiltered, totalPages });
      }
      if (url.pathname === `/api/products/catalog/${catalogId}/suggestions`) {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const scored = [...products.values()].map(p => {
          const fields = [p.name, p.sku, p.brand, p.model].filter(Boolean).map(f => f.toLowerCase());
          return { p, score: p.sku?.toLowerCase() === q ? 0 : p.name.toLowerCase() === q ? 1 : fields.some(f => f.startsWith(q)) ? 2 : fields.some(f => f.includes(q)) ? 3 : 99 };
        }).filter(p => p.score < 99).sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name) || a.p.id.localeCompare(b.p.id));
        if (q === "producto") await wait(700);
        return reply({ products: scored.slice(0, 5).map(item => item.p) });
      }
      if (req.url.startsWith("/api/product-images/product/")) return reply({ images: [] });
    }
    if (req.method === "DELETE" && req.url === `/api/categories/${categoryId}`) {
      categoryDeletes++;
      if (categoryDeleteFails) return reply({ message: "No se pudo eliminar la categoría" }, 500);
      categoryPresent = false;
      return reply({ success: true });
    }
    if (req.method === "DELETE" && req.url.startsWith("/api/products/product-")) {
      for (const [sku, p] of products) if (req.url === `/api/products/${p.id}`) products.delete(sku);
      return reply({ success: true });
    }
    if (req.method === "POST" && req.url.startsWith("/api/auth/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (req.url === "/api/auth/verification/request") { verificationRequests++; return reply({ success: true, retryAfterSeconds: 60, message: "Solicitud registrada." }, 202); }
      if (req.url === "/api/auth/verification/confirm") { verificationConfirms++; emailVerified = true; assert.ok(body.token); return reply({ success: true, message: "Correo verificado." }); }
      if (req.url === "/api/auth/password/forgot") { forgotRequests++; return reply({ success: true, message: "Si corresponde, recibirás instrucciones para recuperar el acceso." }, 202); }
      if (req.url === "/api/auth/password/reset") { passwordResets++; assert.ok(body.token); assert.equal(body.password, body.passwordConfirmation); return reply({ success: true, message: "Contraseña actualizada. Inicia sesión de nuevo en tus dispositivos." }); }
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
  await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*"] });
  step("public-landing-without-session-or-javascript");
  await command("Emulation.setScriptExecutionDisabled", { value: true });
  await command("Page.navigate", { url: "http://localhost:4328/" });
  await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Tu vitrina digital, lista para compartir.'`));
  assert.equal(await evaluate(`location.pathname`), "/");
  assert.equal(await evaluate(`document.querySelectorAll('h1').length`), 1);
  assert.equal(await evaluate(`document.querySelector('meta[name="robots"]').content`), "index, follow");
  assert.equal(await evaluate(`document.querySelector('link[rel="canonical"]').href`), "https://catalogo-pink.vercel.app/");
  assert.ok(await evaluate(`Boolean([...document.querySelectorAll('a')].find(a=>a.textContent.includes('Crear mi catálogo')&&a.getAttribute('href')==='/login'))`));
  assert.ok(await evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Ver un ejemplo'&&b.disabled&&document.getElementById(b.getAttribute('aria-describedby'))?.textContent.includes('próximamente')))`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('footer [role="link"][aria-disabled="true"]')].map(e=>e.textContent)`), ["Contacto", "Privacidad", "Términos"]);
  const socialLinks = [
    { label: "Instagram de Vitrinaya", href: "https://www.instagram.com/vitrinaya.app/" },
    { label: "Facebook de Vitrinaya", href: "https://www.facebook.com/profile.php?id=61595710178606" },
  ];
  const landingResponse = await fetch("http://localhost:4328/");
  assert.equal(landingResponse.status, 200);
  const landingHtml = await landingResponse.text();
  const footerHtml = landingHtml.match(/<footer\b[^]*?<\/footer>/)?.[0];
  assert.ok(footerHtml, "Footer exists in server HTML");
  for (const social of socialLinks) {
    const escapedHref = social.href.replaceAll("&", "&amp;");
    const anchor = footerHtml.match(new RegExp(`<a\\b[^>]*aria-label="${social.label}"[^>]*>`))?.[0];
    assert.ok(anchor?.includes(`href="${escapedHref}"`), `${social.label} has its exact href in server HTML`);
    assert.ok(anchor.includes('target="_blank"'));
    assert.ok(anchor.includes('rel="noopener noreferrer"'));
    assert.ok(!anchor.includes("nofollow"));
  }
  assert.equal(await evaluate(`document.querySelectorAll('footer a').length`), 2);
  assert.ok(await evaluate(`!document.querySelector('[href="#ejemplo"]')&&document.getElementById('footer-coming-soon').textContent.includes('próximamente')`));
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), `Landing fits at ${width}px without JS`);
    for (const social of socialLinks) {
      assert.ok(await evaluate(`(()=>{const a=document.querySelector('footer a[aria-label="${social.label}"]');const r=a.getBoundingClientRect();return a.href===${JSON.stringify(social.href)}&&a.target==='_blank'&&!a.relList.contains('nofollow')&&r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth})()`), `${social.label} is accessible and fits ${width}px without JS`);
    }
    if (width === 390 || width === 1440) {
      const landingShot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(os.tmpdir(), `vitrinaya-landing-${width}.png`), Buffer.from(landingShot.data, "base64"));
    }
  }
  await command("Emulation.clearDeviceMetricsOverride");
  assert.equal(apiReads.length, 0, "Landing does not consult the API");
  await command("Emulation.setScriptExecutionDisabled", { value: false });
  await command("Page.reload");
  await poll(() => evaluate(`Boolean(document.querySelector('footer a[aria-label="Instagram de Vitrinaya"]'))`));
  for (const social of socialLinks) {
    await evaluate(`document.querySelector('footer a[aria-label="${social.label}"]').focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    assert.ok(await evaluate(`document.activeElement.getAttribute('aria-label')==='${social.label}'&&getComputedStyle(document.activeElement).outlineStyle==='solid'&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`), `${social.label} has visible keyboard focus`);
  }
  summary.scenarios.push("social profiles: exact crawlable anchors in server HTML, blank target with noopener noreferrer and no nofollow, 44px targets at four widths without JS, keyboard focus; legal links remain pending");
  step("admin-server-guard");
  for (const userAgent of ["Mozilla/5.0 Chrome/130.0.0.0", "Googlebot"]) {
    for (const cookie of ["", "catalogo_session=user-test-session"]) {
      const response = await fetch("http://localhost:4328/admin", { headers: { "user-agent": userAgent, ...(cookie ? { cookie } : {}) } });
      const html = await response.text();
      assert.equal(response.status, 404, "Admin denial must be a real HTTP 404 before streaming");
      assert.ok(response.headers.get("cache-control").includes("no-store"));
      assert.ok(html.includes("Página no disponible"));
      assert.ok(!html.includes("Administración") && !html.includes("Acceso autorizado."), "Denied HTML cannot contain administrative title or content");
      assert.ok(html.includes('content="noindex, nofollow"'));
    }
  }
  const adminHeaders = { cookie: "catalogo_session=admin-test-session" };
  const authorized = await fetch("http://localhost:4328/admin", { headers: adminHeaders });
  assert.equal(authorized.status, 200); assert.ok((await authorized.text()).includes("Acceso autorizado."));
  adminAllowed = false;
  const demoted = await fetch("http://localhost:4328/admin", { headers: adminHeaders });
  assert.equal(demoted.status, 404); assert.ok(!(await demoted.text()).includes("Acceso autorizado."));
  adminBackendFailed = true;
  const unavailable = await fetch("http://localhost:4328/admin", { headers: adminHeaders });
  assert.equal(unavailable.status, 404); assert.ok(!(await unavailable.text()).includes("Acceso autorizado."));
  adminBackendFailed = false; adminAllowed = true;
  await command("Network.setCookie", { name: "catalogo_session", value: "user-test-session", url: "http://localhost:4328", httpOnly: true, sameSite: "Lax" });
  await command("Page.navigate", { url: "http://localhost:4328/" });
  await poll(() => evaluate(`location.pathname==='/'&&Boolean(document.querySelector('h1'))`));
  await evaluate(`localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'fake-admin',email:'fake@example.invalid',name:null,role:'ADMIN',isAdmin:true}}))`);
  await command("Page.navigate", { url: "http://localhost:4328/admin" });
  await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Página no disponible'`));
  assert.ok(await evaluate(`!document.body.textContent.includes('Administración')&&!document.body.textContent.includes('Acceso autorizado.')`));
  await evaluate(`localStorage.removeItem('catalogo-session')`);
  await command("Network.deleteCookies", { name: "catalogo_session", url: "http://localhost:4328" });
  summary.scenarios.push("admin SSR: real HTTP 404 for anonymous/seller and failed backend, normal and bot user agents, no administrative HTML, no-store/noindex, admin 200 then same-cookie degradation 404, forged localStorage cannot authorize (local simulated API)");
  step("private-dashboard-without-session");
  await command("Page.navigate", { url: "http://localhost:4328/dashboard" });
  await poll(() => evaluate(`location.pathname==='/login'&&Boolean(document.querySelector('button[type="submit"]'))`));
  assert.equal(await evaluate(`document.querySelector('meta[name="robots"]').content`), "noindex, nofollow");
  summary.scenarios.push("public landing without session or JavaScript, no API calls, index/canonical, four widths; anonymous dashboard redirects to noindex login");
  await command("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.hostname==='localhost')localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'test-user',email:'test@example.invalid',name:null}}))` });
  step("login-layout");
  await command("Page.navigate", { url: "http://localhost:4328/login" });
  await poll(() => evaluate(`Boolean(document.querySelector('button[type="submit"]'))`));
  await evaluate(`document.fonts.ready.then(()=>true)`);
  await command("DOM.enable"); await command("CSS.enable");
  const loginDocument = await command("DOM.getDocument");
  const loginHeading = await command("DOM.querySelector", { nodeId: loginDocument.root.nodeId, selector: "h1" });
  const headingFonts = await command("CSS.getPlatformFontsForNode", { nodeId: loginHeading.nodeId });
  assert.ok(headingFonts.fonts.some(font => font.isCustomFont && /Inter/i.test(font.familyName) && font.glyphCount > 0), "Inter is actually used to render heading glyphs");
  assert.equal(await evaluate(`document.title`), "Vitrinaya | Panel de catálogos");
  assert.ok(await evaluate(`(async()=>{const icons=[...document.querySelectorAll('link[rel="icon"]')];if(icons.length!==1||!icons[0].href.includes('/icon.svg')||document.documentElement.outerHTML.includes('/favicon.ico'))return false;const response=await fetch(icons[0].href);return response.ok&&response.headers.get('content-type')?.includes('image/svg+xml')})()`), "Single SVG favicon link resolves successfully with no ICO reference");
  assert.ok(await evaluate(`[...document.querySelectorAll('a[aria-label="Vitrinaya — Ir al inicio"]')].length===2&&[...document.querySelectorAll('a[aria-label="Vitrinaya — Ir al inicio"]')].every(link=>link.getAttribute('href')==='/'&&link.querySelector('[role="img"][aria-label="Vitrinaya"]')&&link.textContent.includes('vitrinaya')&&!link.textContent.includes('Catalogo'))`));
  await evaluate(`(()=>{const p=document.createElement('p');p.id='inter-character-probe';p.textContent='á é í ó ú ñ ü ¿ ¡ y Á É Í Ó Ú Ñ Ü';p.style.fontFamily='var(--font-app-sans)';document.body.append(p)})()`);
  await evaluate(`(async()=>{const p=document.getElementById('inter-character-probe');await document.fonts.load('16px '+getComputedStyle(p).fontFamily,p.textContent);await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true})()`);
  const characterDocument = await command("DOM.getDocument");
  const characterProbe = await command("DOM.querySelector", { nodeId: characterDocument.root.nodeId, selector: "#inter-character-probe" });
  const characterFonts = await command("CSS.getPlatformFontsForNode", { nodeId: characterProbe.nodeId });
  assert.ok(characterFonts.fonts.length > 0 && characterFonts.fonts.every(font => font.isCustomFont && /Inter/i.test(font.familyName)), "Spanish characters and y render in local Inter without fallback");
  await evaluate(`document.getElementById('inter-character-probe').remove()`);
  summary.scenarios.push("Vitrinaya title and login brand; self-hosted Inter renders actual glyphs");
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await poll(() => evaluate(`[...document.querySelectorAll('[role="img"][aria-label="Vitrinaya"]')].filter(e=>e.getBoundingClientRect().width>0).every(e=>e.querySelector('img').naturalWidth>0)`));
    assert.ok(await evaluate(`(()=>{const buttons=[...document.querySelectorAll('button')];return document.documentElement.scrollWidth<=innerWidth+1&&buttons.every(b=>{const r=b.getBoundingClientRect();return b.scrollWidth<=b.clientWidth+1&&r.left>=0&&r.right<=innerWidth})})()`), `Login buttons fit at ${width}px`);
    assert.equal(await evaluate(`document.querySelector('button').textContent.trim()`), "Iniciar sesión");
    assert.ok(await evaluate(`(()=>{const logos=[...document.querySelectorAll('[role="img"][aria-label="Vitrinaya"]')].filter(e=>e.getBoundingClientRect().width>0);return logos.length===1&&logos.every(e=>{const r=e.getBoundingClientRect(),img=e.querySelector('img');return r.left>=0&&r.right<=innerWidth&&img.complete&&img.naturalWidth>0&&e.dataset.theme===(innerWidth>=1024?'oscuro':'claro')})})()`), `Login logo fits at ${width}px`);
  }
  await command("Emulation.clearDeviceMetricsOverride");
  summary.scenarios.push("login labels and button bounds at 320, 390, 1024 and 1440px; Google network blocked");
  step("login-return-to-landing");
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    for (const mode of ["login", "register"]) for (const method of ["keyboard", "click"]) {
      await command("Page.navigate", { url: "http://localhost:4328/login" });
      await poll(() => evaluate(`Boolean(document.querySelector('button[type="submit"]'))`));
      await poll(() => evaluate(`document.readyState==='complete'`));
      await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
      if (mode === "register") {
        await evaluate(`[...document.querySelectorAll('button[type="button"]')].find(b=>b.textContent.trim()==='Crear cuenta').click()`);
        await poll(() => evaluate(`document.querySelector('h1').textContent==='Crea tu cuenta.'`));
      }
      assert.ok(await evaluate(`(()=>{const link=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Volver al inicio');if(!link)return false;const r=link.getBoundingClientRect();return link.getAttribute('href')==='/'&&r.height>=44&&r.width>0&&r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth+1})()`), `${mode} return link fits ${width}px`);
      if (method === "keyboard") {
        await evaluate(`[...document.querySelectorAll('a[aria-label="Vitrinaya — Ir al inicio"]')].find(a=>a.getBoundingClientRect().width>0).focus()`);
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.ok(await evaluate(`document.activeElement.textContent.trim()==='Volver al inicio'&&getComputedStyle(document.activeElement).outlineStyle==='solid'&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`), `Return link has keyboard focus in ${mode} at ${width}px`);
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        assert.ok(await evaluate(`document.activeElement.getAttribute('aria-label')==='Vitrinaya — Ir al inicio'&&getComputedStyle(document.activeElement).cursor==='pointer'&&getComputedStyle(document.activeElement).outlineStyle==='solid'&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`), `Visible logo has keyboard focus in ${mode} at ${width}px`);
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      } else {
        const point = await evaluate(`(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Volver al inicio');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
        await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
      }
      await poll(() => evaluate(`location.pathname==='/'&&document.querySelector('h1')?.textContent==='Tu vitrina digital, lista para compartir.'`));
    }
  }
  await command("Emulation.clearDeviceMetricsOverride");
  summary.scenarios.push("login and register: explicit home link navigates by actual pointer click and Tab/Enter at 320/390/1024/1440px; visible logo and return link have keyboard focus outlines, correct href and no overflow");
  step("account-verification-and-recovery");
  await command("Page.navigate", { url: "http://localhost:4328/dashboard" });
  await poll(() => evaluate(`Boolean(document.querySelector('aside[aria-label="Verificación de correo"]'))`));
  // The notice and catalog list load independently; wait for both before asserting.
  await poll(() => evaluate(`Boolean(document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]'))`));
  assert.ok(await evaluate(`document.querySelector('aside[aria-label="Verificación de correo"]').textContent.includes('owner@example.invalid')&&Boolean(document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]'))`));
  await click("Reenviar verificación");
  await poll(() => evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.startsWith('Reenviar en ')&&b.disabled)`));
  assert.equal(verificationRequests, 1);
  emailVerified = true;
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await poll(() => evaluate(`!document.querySelector('aside[aria-label="Verificación de correo"]')`));
  emailVerified = false;
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await poll(() => evaluate(`Boolean(document.querySelector('aside[aria-label="Verificación de correo"]'))`));
  const demoToken = "v".repeat(43);
  for (const path of ["verificar-correo", "restablecer-contrasena", "recuperar-contrasena"]) {
    const response = await fetch(`http://localhost:4328/${path}`), html = await response.text();
    assert.equal(response.status, 200); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.ok(response.headers.get("cache-control").includes("no-store"));
    assert.ok(html.includes('content="noindex, nofollow"')); assert.ok(!html.includes(demoToken));
  }
  for (const path of ["verificar-correo", "restablecer-contrasena"]) {
    await command("Page.navigate", { url: `http://localhost:4328/${path}#token=${demoToken}` });
    await poll(() => evaluate(`location.hash===''&&Boolean(document.querySelector('button[type="submit"]:not(:disabled)'))`));
    assert.equal(verificationConfirms, 0); assert.equal(passwordResets, 0, "Opening a link cannot consume it");
    for (const width of [320, 390, 1024, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), `Account form fits ${width}px`);
    }
  }
  await command("Emulation.clearDeviceMetricsOverride");
  await input('input[type="password"]', "new-password");
  await input('label:nth-of-type(2) input[type="password"]', "new-password");
  await click("Cambiar contraseña");
  await poll(() => evaluate(`document.querySelector('[role="status"]')?.textContent.includes('Contraseña actualizada')`));
  assert.equal(passwordResets, 1); assert.equal(await evaluate(`location.pathname`), "/restablecer-contrasena");
  await command("Page.navigate", { url: `http://localhost:4328/verificar-correo#token=${demoToken}` });
  await poll(() => evaluate(`Boolean(document.querySelector('button[type="submit"]:not(:disabled)'))`));
  await click("Confirmar mi correo");
  await poll(() => evaluate(`document.querySelector('[role="status"]')?.textContent==='Correo verificado.'`));
  assert.equal(verificationConfirms, 1);
  await command("Page.navigate", { url: "http://localhost:4328/recuperar-contrasena" });
  await poll(() => evaluate(`Boolean(document.querySelector('input[type="email"]'))`));
  await input('input[type="email"]', "missing@example.invalid"); await click("Solicitar instrucciones");
  await poll(() => evaluate(`document.querySelector('[role="status"]')?.textContent.includes('Si corresponde')`));
  assert.equal(forgotRequests, 1);
  await command("Page.navigate", { url: "http://localhost:4328/dashboard" });
  await poll(() => evaluate(`Boolean(document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]'))`));
  assert.equal(await evaluate(`Boolean(document.querySelector('aside[aria-label="Verificación de correo"]'))`), false);
  summary.scenarios.push("account flows: persistent nonblocking server-backed notice and resend cooldown; token pages no-store/noindex/no-referrer, fragments cleared, GET never consumes, explicit confirmation/reset without auto-login, generic recovery, four widths (simulated API)");
  await command("Page.navigate", { url: "http://localhost:4328/" });
  await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Tu vitrina digital, lista para compartir.'`));
  assert.ok(await evaluate(`localStorage.getItem('catalogo-session')!==null&&location.pathname==='/'`));
  await command("Page.navigate", { url: "http://localhost:4328/dashboard" });
  step("workspace");
  await poll(() => evaluate(`Boolean(document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]'))`));
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.textContent==='Cerrar sesión').length`), 1);
  assert.equal(await evaluate(`document.querySelector('meta[name="robots"]').content`), "noindex, nofollow");
  await evaluate(`document.querySelector('a[href="/dashboard/catalogos/${catalogId}"]').click()`);
  await poll(() => evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Importar Excel')`));
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await evaluate(`(()=>{const logo=document.querySelector('header [role="img"][aria-label="Vitrinaya"]');if(!logo)return false;const r=logo.getBoundingClientRect(),header=logo.closest('header');return logo.dataset.theme==='claro'&&r.left>=0&&r.right<=innerWidth&&header.scrollWidth<=innerWidth&&logo.querySelector('img').naturalWidth>0})()`), `Dashboard logo fits at ${width}px`);
  }
  await command("Emulation.clearDeviceMetricsOverride");
  summary.scenarios.push("local Inter Spanish uppercase/lowercase, opening punctuation and y; login/dashboard logos fit 320/390/1024/1440px with correct themes");
  step("scaled-product-list");
  const listReadsStart = apiReads.length;
  products.clear();
  for (let i = 1; i <= 57; i++) {
    const sku = `SCALE-${String(i).padStart(3, "0")}`;
    products.set(sku, { ...product(`Producto ${String(i).padStart(3, "0")}`, sku), price: i, stock: i % 2, active: i % 2 === 0,
      brand: i === 57 ? "Fuera de página" : null, categoryId: i % 3 === 0 ? categoryId : null, category: i % 3 === 0 ? category : null });
  }
  const workspaceUrl = `http://localhost:4328/dashboard/catalogos/${catalogId}`;
  await command("Page.navigate", { url: workspaceUrl });
  await poll(() => rangeIs("Mostrando 1–24 de 57"));
  assert.equal(await evaluate(`document.querySelectorAll('section[aria-busy] article').length`), 24);
  await input('input[placeholder="Ej. Lámpara de mesa"]', "Borrador al paginar");
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Siguiente').focus()`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await poll(() => rangeIs("Mostrando 25–48 de 57"));
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('page')`), "2");
  assert.equal(await evaluate(`document.querySelector('input[placeholder="Ej. Lámpara de mesa"]').value`), "Borrador al paginar");
  await input("#product-source-search", "producto");
  await poll(() => apiReads.some(url => url.includes("/suggestions?q=producto")));
  await input("#product-source-search", "SCALE-057");
  await poll(() => evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Producto 057')&&b.textContent.includes('Usar datos'))`));
  await wait(800);
  assert.equal(await evaluate(`document.querySelectorAll('button').length>0&&[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Usar datos')).length`), 1);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Usar datos')).click()`);
  assert.equal(await evaluate(`document.querySelector('input[placeholder="Ej. Lámpara de mesa"]').value`), "Producto 057");
  await input('input[placeholder="Ej. Lámpara de mesa"]', "Borrador al paginar");
  step("product-list-page-sizes");
  await selectControl("Productos por página", "48");
  await poll(() => rangeIs("Mostrando 1–48 de 57"));
  await selectControl("Productos por página", "96");
  await poll(() => rangeIs("Mostrando 1–57 de 57"));
  await selectControl("Productos por página", "24");
  step("product-list-filters");
  await selectControl("Estado", "inactive");
  await poll(() => rangeIs("Mostrando 1–24 de 29"));
  await selectControl("Stock informativo", "out");
  await poll(() => rangeIs("Mostrando 0–0 de 0"));
  assert.ok(await evaluate(`document.body.textContent.includes('No hay productos que coincidan')&&document.body.textContent.includes('57 en total · 0 coinciden')`));
  await click("Limpiar filtros");
  await poll(() => rangeIs("Mostrando 1–24 de 57"));
  await selectControl("Categoría", "none");
  step("product-list-category-order");
  await poll(() => rangeIs("Mostrando 1–24 de 38"));
  await selectControl("Ordenar por", "price");
  await selectControl("Dirección", "asc");
  await poll(() => evaluate(`document.querySelector('section[aria-busy] article p')?.textContent==='Producto 001'`));
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), `Private product controls fit ${width}px`);
  }
  await command("Emulation.clearDeviceMetricsOverride");
  await command("Page.reload");
  step("product-list-history");
  await poll(() => rangeIs("Mostrando 1–24 de 38"));
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('sort')`), "price");
  await selectControl("Estado", "active");
  await poll(() => rangeIs("Mostrando 1–19 de 19"));
  await evaluate(`history.back()`);
  await poll(() => rangeIs("Mostrando 1–24 de 38"));
  const qReadsStart = apiReads.length;
  step("product-list-search");
  await input("#product-list-search", "Fuera");
  await input("#product-list-search", "Fuera de");
  await input("#product-list-search", "Fuera de página");
  await poll(() => rangeIs("Mostrando 0–0 de 0"));
  assert.equal(apiReads.slice(qReadsStart).filter(url => url.includes("/list?")).length, 1, "Typing is debounced into one listing request");
  const staleReadsStart = apiReads.length;
  await input("#product-list-search", "Producto");
  await poll(() => apiReads.slice(staleReadsStart).some(url => new URL(url, "https://localhost").searchParams.get("q") === "Producto"));
  await input("#product-list-search", "SCALE-055");
  await poll(() => rangeIs("Mostrando 1–1 de 1"));
  await wait(800);
  assert.equal(await evaluate(`document.querySelector('section[aria-busy] article p')?.textContent`), "Producto 055", "Late listing response cannot overwrite newer results");
  await click("Limpiar filtros");
  await poll(() => rangeIs("Mostrando 1–24 de 57"));
  assert.ok(!apiReads.slice(listReadsStart).some(url => url.includes("/product-images/product/") || url === `/api/products/catalog/${catalogId}`), "No legacy full download or per-product image requests");
  for (let i = 50; i <= 57; i++) products.delete(`SCALE-${String(i).padStart(3, "0")}`);
  step("product-list-last-page-delete");
  await command("Page.navigate", { url: `${workspaceUrl}?page=3` });
  await poll(() => rangeIs("Mostrando 49–49 de 49"));
  await evaluate(`window.confirm=()=>true`);
  await click("Eliminar");
  await poll(() => rangeIs("Mostrando 25–48 de 48"));
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('page')`), "2");
  products.clear(); products.set("EXISTENTE", product("Existente", "EXISTENTE"));
  await command("Page.navigate", { url: workspaceUrl });
  await poll(() => rangeIs("Mostrando 1–1 de 1"));
  summary.scenarios.push("57 products: server page sizes/counts, keyboard paging, draft preservation, remote editor match outside page and stale response discarded, debounce, combined filters, empty reset, URL refresh/back, four widths, deletion clamps last page, no per-product image HTTP calls (simulated API)");
  step("category-delete");
  const productCountBeforeDelete = products.size;
  await evaluate(`window.confirm=()=>false`);
  await click("Eliminar categoría"); assert.equal(categoryDeletes, 0);
  await evaluate(`window.confirm=message=>{window.categoryConfirmation=message;return true}`);
  categoryDeleteFails = true; await click("Eliminar categoría");
  await poll(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('No se pudo eliminar la categoría')`));
  assert.ok(await evaluate(`window.categoryConfirmation.includes('quedarán sin categoría')&&window.categoryConfirmation.includes('Los pedidos se conservan')`));
  categoryDeleteFails = false; await click("Eliminar categoría");
  await poll(() => evaluate(`![...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Eliminar categoría Manos Libres')`));
  assert.equal(categoryDeletes, 2); assert.equal(products.size, productCountBeforeDelete);
  summary.scenarios.push("category deletion: cancel, explanation, visible API error and success without deleting products (simulated API)");
  await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Ej. Lámpara de mesa"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Borrador conservado');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  assert.equal(await click("Importar Excel"), true);
  await poll(() => evaluate(`document.activeElement?.id==='product-import-title'`));
  assert.ok(await evaluate(`Boolean(document.querySelector('a[download="plantilla-productos.xlsx"]'))`));
  step("native-file-chooser");
  await command("Page.setInterceptFileChooserDialog", { enabled: true });
  const picker = await evaluate(`(()=>{const input=document.getElementById('product-import-file'),label=input.labels[0];label.scrollIntoView({block:'center'});const r=label.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,rect:{left:r.left,top:r.top,width:r.width,height:r.height},disabled:input.disabled,hit:label.contains(document.elementFromPoint(x,y)),label:label.textContent,accept:input.accept}})()`);
  summary.pickerGeometry = picker;
  summary.selectionLayout = await selectionLayout();
  assert.equal(summary.selectionLayout.text, "Ningún archivo seleccionado");
  assert.ok(Math.abs(summary.selectionLayout.selector.centerY - summary.selectionLayout.state.centerY) < 1);
  assert.ok(summary.selectionLayout.state.left >= summary.selectionLayout.selector.left + summary.selectionLayout.selector.width);
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
  summary.mobileSelectionLayout = await selectionLayout();
  assert.ok(Math.abs(summary.mobileSelectionLayout.selector.centerY - summary.mobileSelectionLayout.state.centerY) < 1);
  assert.ok(summary.mobileSelectionLayout.state.left >= summary.mobileSelectionLayout.selector.left + summary.mobileSelectionLayout.selector.width);
  assert.equal(mobilePicker.hit, true);
  assert.equal(mobilePicker.fits, true);
  assert.ok(mobilePicker.rect.height >= 44);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: mobilePicker.x, y: mobilePicker.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: mobilePicker.x, y: mobilePicker.y, button: "left", clickCount: 1 });
  await poll(() => fileChoosers.length === 3);
  await command("Emulation.clearDeviceMetricsOverride");
  await command("Page.setInterceptFileChooserDialog", { enabled: false });
  summary.scenarios.push("visible file label opens picker by pointer and Tab+Space; focus outline, 44px target, correct accept and no overlay");
  step("partial-identities"); await select(files.identities);
  await poll(async () => (await status()).includes("Reporte final"));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#product-import-panel tbody tr')].map(row=>[...row.querySelectorAll('td')].slice(0,2).map(cell=>cell.textContent))`), [["Sin nombre", "001"], ["No disponible", "002"]]);
  assert.ok(!await evaluate(`document.getElementById('product-import-panel').textContent.includes('filas no tienen SKU o Modelo')`));
  step("all-invalid-format-warning"); await select(files.allInvalid);
  await poll(() => evaluate(`document.getElementById('product-import-panel').textContent.includes('No hay filas válidas para continuar.')`));
  assert.equal(await click("Continuar con las filas válidas"), false);
  assert.equal(previewCalls.length, 0);
  step("real-reader-and-mixed-preview"); await select(files.mixed);
  await poll(() => evaluate(`document.getElementById('product-import-panel').textContent.includes('1 de 3 filas no tienen SKU o Modelo guardados como texto.')`));
  assert.equal(previewCalls.length, 0);
  assert.ok(await evaluate(`document.querySelector('tbody').textContent.includes('SKU numérico')`));
  assert.ok(await evaluate(`document.querySelector('tbody').textContent.includes("Ayuda: Selecciona la columna, aplica formato Texto antes de escribir y reescribe los valores.")`));
  assert.equal(await click("Continuar con las filas válidas"), true);
  await poll(async () => (await status()).includes("Lista para revisar"));
  assert.equal(await evaluate(`document.getElementById('product-import-file-name').textContent`), "mixed.xlsx");
  summary.selectedFileLayout = await selectionLayout();
  assert.ok(Math.abs(summary.selectedFileLayout.selector.centerY - summary.selectedFileLayout.state.centerY) < 1);
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
  step("main-panel-logout"); reset("normal");
  await command("Page.navigate", { url: "http://localhost:4328/dashboard" });
  await poll(() => evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Cerrar sesión')`));
  await command("Network.setCookie", { name: "catalogo_session", value: "synthetic-browser-session", url: "http://localhost:4328/", httpOnly: true, secure: true, path: "/" });
  assert.ok((await command("Network.getCookies", { urls: ["http://localhost:4328/"] })).cookies.some(cookie => cookie.name === "catalogo_session" && cookie.httpOnly));
  await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*/api/backend/auth/logout"] });
  await click("Cerrar sesión");
  await poll(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('No se pudo cerrar la sesión del servidor')`));
  assert.equal(await evaluate(`location.pathname`), "/dashboard");
  await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*"] });
  step("main-panel-logout-keyboard");
  await command("Page.bringToFront");
  await evaluate(`document.querySelectorAll('button')[0].focus()`);
  assert.equal(await evaluate(`document.activeElement.textContent`), "Cerrar sesión");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await poll(() => evaluate(`location.pathname==='/login'&&localStorage.getItem('catalogo-session')===null`));
  assert.ok(!(await command("Network.getCookies", { urls: ["http://localhost:4328/"] })).cookies.some(cookie => cookie.name === "catalogo_session"));
  summary.scenarios.push("main-panel keyboard logout clears local metadata and redirects after same-origin logout");
  summary.passed = true;
} catch (error) { summary.failure = error instanceof Error ? error.message : "BROWSER_CHECK_FAILED"; summary.failedStage = stage; summary.browserErrors = browserErrors; summary.apiReadCount = apiReads.length; summary.previewBatches = previewCalls; if (socket?.readyState === WebSocket.OPEN) { try { summary.pageState = await evaluate(`({path:location.pathname,hasVisualSession:localStorage.getItem('catalogo-session')!==null})`); summary.importResponses = []; for (const response of importResponses) { const data = await command("Network.getResponseBody", { requestId: response.requestId }); const body = JSON.parse(data.body); summary.importResponses.push({ status: response.status, success: body.success, errorCode: body.error, ready: body.ready, hasToken: Boolean(body.previewToken), rows: body.rows?.map(row=>({rowNumber:row.rowNumber,action:row.action})) }); } summary.visibleStatus = await status(); summary.visibleAlert = await evaluate(`document.querySelector('[role="alert"]')?.textContent||''`); summary.pageHeading = await evaluate(`document.querySelector('h1')?.textContent||''`); } catch { /* Browser may already be closed. */ } } process.exitCode = 1; }
finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command("Browser.close"); } catch { /* Chrome may close its connection before replying. */ } socket.close(); }
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (next && next.exitCode === null) { const exited = once(next, "exit", { signal: AbortSignal.timeout(3000) }).catch(() => {}); next.kill(); await exited; next.stdout.destroy(); next.stderr.destroy(); next.unref(); }
  if (api) { api.closeAllConnections(); api.close(); }
  fs.writeFileSync(path.join(os.tmpdir(), "catalogo-import-browser-results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
