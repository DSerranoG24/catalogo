import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), { WebSocket } = require('next/dist/compiled/ws');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-offer-browser-'));
const id = '11111111-1111-4111-8111-111111111111';
const catalog = { id, publicId: id, name: 'Ofertas fixture', slug: 'fixture', template: 'TECH', active: true, archivedAt: null, logoUrl: null };
const products = ['Producto A', 'Producto B'].map((name, i) => ({ id: `22222222-2222-4222-8222-22222222222${i}`, catalogId: id, name, slug: `producto-${i}`, price: 101, stock: 1, active: true, featured: false, needsCompletion: false, categoryId: null, category: null, images: [], description: null, brand: null, model: null, sku: null, salePrice: null, saleStartsAt: null, saleEndsAt: null }));
const writes = [], errors = [], checks = [];
let api, next, chrome, socket, sequence = 0, stage = 'startup';
const pending = new Map(), report = { success: false, productionAccess: false, realDatabase: false, checks };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(work) { for (let i = 0; i < 250; i++) { if (await work()) return; await pause(60); } throw Error('TIMEOUT:' + stage); }
function command(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP_TIMEOUT:' + method)); }, 15000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error('EVALUATION:' + stage + ':' + (result.exceptionDetails.exception?.description?.split('\n')[0] ?? result.exceptionDetails.text)); return result.result.value; }
async function click(text) { assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`), 'Missing/enabled button: ' + text); }
async function fill(selector, text) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`); await command('Input.insertText', { text }); }
const base = 'input[placeholder="25000"]', sale = 'input[placeholder="18000"]', percent = '[data-sale-calculator] input';
const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
async function edit(name) {
  await poll(() => evaluate(`Boolean([...document.querySelectorAll('article')].find(a=>a.textContent.includes(${JSON.stringify(name)})))`));
  await evaluate(`(()=>{const a=[...document.querySelectorAll('article')].find(a=>a.textContent.includes(${JSON.stringify(name)}));[...a.querySelectorAll('button')].find(b=>b.textContent==='Editar').click()})()`);
  await poll(() => evaluate(`document.querySelector('input[maxlength="150"]').value===${JSON.stringify(name)}`));
}
async function enableSale() { if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(sale)}))`)) await evaluate(`document.querySelector('fieldset input[type=checkbox]').click()`); await poll(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(sale)}))`)); }
async function dates(start = '2030-11-01T09:00', end = '2030-11-02T09:00') {
  await evaluate(`(()=>{
    const inputs=document.querySelectorAll('input[type=datetime-local]');
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    [${JSON.stringify(start)},${JSON.stringify(end)}].forEach((v,i)=>{
      set.call(inputs[i],v);
      inputs[i].dispatchEvent(new Event('input',{bubbles:true}));
      inputs[i].dispatchEvent(new Event('change',{bubbles:true}));
    });
  })()`);
}
async function save() {
  const count = writes.length; await click('Guardar cambios');
  await poll(() => writes.length === count + 1);
  await poll(() => evaluate(`!document.body.textContent.includes('Actualizar producto')`));
  const payload = writes.at(-1);
  assert.ok(Number.isInteger(payload.salePrice));
  assert.ok(Number.isFinite(Date.parse(payload.saleStartsAt)) && Number.isFinite(Date.parse(payload.saleEndsAt)));
  assert.ok(Date.parse(payload.saleStartsAt) < Date.parse(payload.saleEndsAt));
  assert.deepEqual(Object.keys(payload).sort(), ['brand', 'model', 'name', 'price', 'saleEndsAt', 'salePrice', 'saleStartsAt', 'slug', 'stock'].sort());
  return payload;
}
try {
  const pem = execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', '-', '-out', '-', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const cert = pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0], key = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0]; assert.ok(cert && key);
  const ca = path.join(folder, 'localhost-cert.pem'); fs.writeFileSync(ca, cert);
  api = https.createServer({ key, cert }, async (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1:4339');
    const reply = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET') {
      if (url.pathname === '/api/me') return reply({ user: { emailVerifiedAt: '2026-10-28T00:00:00Z', hasLocalPassword: true } });
      if (url.pathname === `/api/catalogs/${id}`) return reply({ catalog });
      if (url.pathname === `/api/categories/catalog/${id}`) return reply({ categories: [] });
      if (url.pathname.endsWith('/featured')) return reply({ products: [], selectedCount: 0, validCount: 0, visible: false, warning: null });
      if (url.pathname.endsWith('/list')) return reply({ products, page: 1, pageSize: 24, totalProducts: 2, totalFiltered: 2, totalPages: 1, needsCompletionCount: 0 });
      if (url.pathname.endsWith('/suggestions')) return reply({ products: [] });
      return reply({ message: 'Unexpected fixture route' }, 404);
    }
    const product = products.find(product => url.pathname === `/api/products/${product.id}`);
    assert.ok(product && req.method === 'PUT', 'Only product updates are allowed in this fixture');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    writes.push(payload); Object.assign(product, payload); reply({ success: true });
  }); api.listen(4339, '127.0.0.1'); await once(api, 'listening');
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '4338'], { env: { ...process.env, CATALOG_API_URL: 'https://127.0.0.1:4339/api', NODE_EXTRA_CA_CERTS: ca }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); next.stdout.resume(); next.stderr.resume();
  await poll(async () => { try { return (await fetch('http://localhost:4338/login')).ok; } catch { return false; } });
  const executable = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync); assert.ok(executable);
  chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--allow-insecure-localhost', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${path.join(folder, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(folder, 'profile', 'DevToolsActivePort'); await poll(() => fs.existsSync(portFile)); const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(Error(message.error.message)); else item?.resolve(message.result); } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['*accounts.google.com/*', '*fonts.googleapis.com/*', '*fonts.gstatic.com/*'] });
  await command('Network.setCookie', { name: 'catalogo_session', value: 'synthetic-fixture', url: 'http://localhost:4338/', httpOnly: true, sameSite: 'Lax' });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.hostname==='localhost')localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'fixture',email:'fixture@example.invalid',name:null}}))` });
  await command('Page.navigate', { url: `http://localhost:4338/dashboard/catalogos/${id}` });
  stage = 'manual-offer'; await edit('Producto A'); await enableSale(); await fill(sale, '80'); await dates();
  assert.equal((await save()).salePrice, 80);
  checks.push('Existing manual offer saves its integer price and mandatory ISO dates without percentage fields');
  stage = 'rounding-and-manual-override'; await edit('Producto A'); await fill(base, '4'); await fill(percent, '40'); await click('Aplicar porcentaje');
  assert.equal(await value(sale), '3'); assert.ok(await evaluate(`document.querySelector('[data-sale-calculator]').textContent.includes('Eso equivale a un 25% de descuento.')`));
  await fill(sale, '2'); assert.equal(await value(percent), ''); assert.equal((await save()).salePrice, 2);
  checks.push('Ceil rounding (4 at 40% becomes 3) reports effective 25%; manual edit clears auxiliary percentage and saves');
  stage = 'no-effective-discount'; await edit('Producto A'); await fill(percent, '20'); await click('Aplicar porcentaje');
  assert.equal(await value(sale), '2');
  assert.ok(await evaluate(`document.querySelector('[data-sale-calculator] [role=alert]').textContent==='Con este precio base, ese porcentaje no produce un descuento real. Ajusta el porcentaje o el precio de oferta a mano.'`));
  for (const invalid of ['0', '100', '-1', '1.5']) {
    await fill(percent, invalid); await click('Aplicar porcentaje'); assert.equal(await value(sale), '2');
    assert.ok(await evaluate(`document.querySelector('[data-sale-calculator] [role=alert]').textContent.includes('entero entre 1 y 99')`));
  }
  assert.equal(writes.length, 2);
  checks.push('Ineffective discounts and 0, 100, negative and decimal percentages warn before save and never replace salePrice');
  stage = 'explicit-reapplication'; await fill(base, '101'); await fill(percent, '20'); await click('Aplicar porcentaje'); assert.equal(await value(sale), '81');
  await fill(base, '201'); assert.equal(await value(sale), '81'); assert.equal(await value(percent), '20');
  assert.equal(await evaluate(`document.querySelectorAll('[data-sale-calculator] [role=status]').length`), 0);
  await click('Aplicar porcentaje'); assert.equal(await value(sale), '161'); assert.equal((await save()).salePrice, 161);
  checks.push('Changing the base leaves salePrice unchanged; only a second explicit click recalculates it');
  stage = 'mandatory-dates'; await edit('Producto A');
  for (const pair of [['', '2030-11-02T09:00'], ['2030-11-01T09:00', '']]) {
    await dates(...pair); await click('Guardar cambios'); await pause(100); assert.equal(writes.length, 3);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(sale)}).form.checkValidity()`), false);
  }
  await dates('2030-11-02T09:00', '2030-11-01T09:00'); await click('Guardar cambios'); await pause(100); assert.equal(writes.length, 3);
  assert.ok(await evaluate(`document.body.textContent.includes('las fechas formar un periodo válido')`));
  checks.push('Both dates remain required and reversed ranges are rejected by the existing workspace validation');
  stage = 'draft-reset'; await fill(percent, '30'); await edit('Producto B'); await enableSale(); assert.equal(await value(percent), '');
  await fill(percent, '30'); await edit('Producto A'); assert.equal(await value(percent), '');
  await fill(percent, '30'); await click('Cancelar'); await enableSale(); assert.equal(await value(percent), '');
  checks.push('Switching products and cancelling reset auxiliary percentage without changing the form contract');
  for (const width of [320, 390, 1024, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Overflow at ' + width);
  }
  assert.deepEqual(errors, []); report.success = true;
} catch (error) { report.stage = stage; report.error = error instanceof Error ? error.message : 'CHECK_FAILED'; }
finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close(); if (chrome) chrome.kill(); if (next) next.kill();
  if (api) { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
  report.browserErrors = errors; report.fixtureWrites = writes.length;
  fs.writeFileSync(path.join(os.tmpdir(), 'product-offer-browser-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('catalog-offer-browser-'));
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Isolated profile may still be releasing its files. */ }
  if (!report.success) process.exitCode = 1;
}
