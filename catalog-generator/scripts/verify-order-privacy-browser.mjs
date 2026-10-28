import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WebSocket } = require('next/dist/compiled/ws');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-privacy-browser-'));
const id = '11111111-1111-4111-8111-111111111111';
const catalog = { id, publicId: id, name: 'Fixture privacidad', slug: 'fixture', template: 'TECH', active: true, archivedAt: null, logoUrl: null };
let orders = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map((status, i) => ({
  id: `order-${i}`, customerName: `Cliente fixture ${i}`, customerPhone: '3000000000', customerEmail: null,
  customerAddress: 'Dirección fixture', customerConsentAt: '2026-10-27T12:00:00Z', customerConsentVersion: null,
  anonymizedAt: null, notes: 'Nota fixture', status, total: 1000, createdAt: '2026-10-27T12:00:00Z', quotationNumber: i + 1,
  quotationSellerSnapshot: { name: 'Negocio fixture', quotationTerms: 'Texto libre que debe revisarse ' + 'x'.repeat(300) },
  items: [{ productName: 'Producto fixture', quantity: 2, unitPrice: 500, subtotal: 1000 }],
}));
const writes = [], errors = [], checks = [];
let api, next, chrome, socket, sequence = 0, stage = 'startup';
const pending = new Map();
const report = { success: false, realDatabase: false, productionAccess: false, checks };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(work) { for (let i = 0; i < 250; i++) { if (await work()) return; await pause(60); } throw Error('TIMEOUT:' + stage); }
function command(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP_TIMEOUT:' + method)); }, 15000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error('EVALUATION:' + stage); return result.result.value; }
async function click(text) { return evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`); }
async function fill(selector, text) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`); await command('Input.insertText', { text }); }
async function navigate(route) { await command('Page.navigate', { url: 'http://localhost:4338' + route }); }
try {
  const pem = execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', '-', '-out', '-', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const cert = pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
  const key = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0]; assert.ok(cert && key);
  const ca = path.join(folder, 'localhost-cert.pem'); fs.writeFileSync(ca, cert);
  api = https.createServer({ key, cert }, async (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1:4339');
    const reply = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET') {
      if (url.pathname === '/api/me') return reply({ user: { email: 'fixture@example.invalid', emailVerifiedAt: '2026-10-27T00:00:00Z', hasLocalPassword: true } });
      if (url.pathname === `/api/catalogs/${id}`) return reply({ catalog });
      if (url.pathname === `/api/categories/catalog/${id}`) return reply({ categories: [] });
      if (url.pathname.endsWith('/featured')) return reply({ products: [], selectedCount: 0, validCount: 0, visible: false, warning: null });
      if (url.pathname.endsWith('/list')) return reply({ products: [], page: 1, pageSize: 24, totalProducts: 0, totalFiltered: 0, totalPages: 1, needsCompletionCount: 0 });
      if (url.pathname === `/api/orders/catalog/${id}`) return url.searchParams.has('cursor')
        ? reply({ orders: [{ ...orders[2], id: 'old-order', customerName: 'Cliente antiguo fixture' }], nextCursor: null })
        : reply({ orders, nextCursor: '99999999-9999-4999-8999-999999999999' });
      return reply({ message: 'Fixture route not found' }, 404);
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    writes.push({ path: url.pathname, method: req.method, data });
    if (url.pathname === '/api/auth/close') return data.password === 'fixture-password' ? reply({ success: true, job: { id: 'job-fixture', phase: 'PENDING' } }, 202) : reply({ message: 'Verifica de nuevo tu identidad.' }, 403);
    const order = orders.find(order => url.pathname.includes('/' + order.id));
    if (!order) return reply({ message: 'No encontrado' }, 404);
    if (req.method === 'DELETE') { assert.equal(order.status, 'PENDING'); orders = orders.filter(item => item !== order); return reply({ success: true }); }
    assert.ok(['COMPLETED', 'CANCELLED'].includes(order.status));
    assert.equal(data.clientDataReviewed, true);
    Object.assign(order, { anonymizedAt: '2026-10-27T13:00:00Z', customerName: 'Cliente anonimizado', customerPhone: '', customerAddress: null, notes: null });
    return reply({ success: true, anonymizedAt: order.anonymizedAt });
  });
  api.listen(4339, '127.0.0.1'); await once(api, 'listening');
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '4338'], { env: { ...process.env, CATALOG_API_URL: 'https://127.0.0.1:4339/api', NODE_EXTRA_CA_CERTS: ca }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); next.stdout.resume(); next.stderr.resume();
  await poll(async () => { try { return (await fetch('http://localhost:4338/login')).ok; } catch { return false; } });
  const executable = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync); assert.ok(executable);
  chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--allow-insecure-localhost', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${path.join(folder, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(folder, 'profile', 'DevToolsActivePort'); await poll(() => fs.existsSync(portFile));
  const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(Error(message.error.message)); else item?.resolve(message.result); } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); });
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['*accounts.google.com/*', '*fonts.googleapis.com/*', '*fonts.gstatic.com/*'] });
  await command('Network.setCookie', { name: 'catalogo_session', value: 'synthetic-fixture', url: 'http://localhost:4338/', httpOnly: true, sameSite: 'Lax' });
  const seed = await command('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.hostname==='localhost')localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'fixture',email:'fixture@example.invalid',name:null}}))` });
  stage = 'order-actions'; await navigate(`/dashboard/catalogos/${id}`);
  await poll(() => evaluate(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Órdenes'))`));
  await click('Órdenes'); await poll(() => evaluate(`document.querySelectorAll('article').length===4`));
  assert.equal(await evaluate(`document.querySelectorAll('button').length>0&&[...document.querySelectorAll('button')].filter(e=>e.textContent==='Anonimizar datos del cliente').length`), 2);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].filter(e=>e.textContent==='Eliminar pedido pendiente').length`), 1);
  checks.push('Actions visible only for allowed order states');
  await click('Más antiguos'); await poll(() => evaluate(`document.body.textContent.includes('Cliente antiguo fixture')`));
  await click('Más recientes'); await poll(() => evaluate(`document.querySelectorAll('article').length===4`));
  checks.push('Older orders remain accessible through bounded pagination');
  stage = 'anonymize-review'; await click('Anonimizar datos del cliente'); await poll(() => evaluate(`Boolean(document.querySelector('[role=dialog]'))`));
  for (const width of [320, 390, 1024, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Dialog overflow at ' + width);
  }
  assert.equal(await click('Confirmar operación irreversible'), false);
  assert.equal(writes.length, 0);
  await evaluate(`(()=>{const d=document.querySelector('[role=dialog]');const c=d.querySelectorAll('input[type=checkbox]');c[0].click();c[c.length-1].click()})()`);
  await fill('[role=dialog] input:not([type=checkbox])', 'ANONIMIZAR');
  await evaluate(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Confirmar operación irreversible');b.focus()})()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await poll(() => evaluate(`document.body.textContent.includes('Datos del cliente anonimizados')`));
  assert.equal(writes[0].data.redactProductNames, true); assert.deepEqual(writes[0].data.redactSellerFields, []);
  checks.push('Explicit review and typed confirmation required; keyboard submission; refresh shows anonymized state');
  stage = 'delete-confirmation'; await click('Eliminar pedido pendiente'); await poll(() => evaluate(`Boolean(document.querySelector('[role=dialog]'))`));
  await fill('[role=dialog] input', 'incorrecto');
  await fill('[role=dialog] label:last-of-type input', 'ELIMINAR');
  assert.equal(await click('Confirmar operación irreversible'), false);
  await fill('[role=dialog] input', 'Cliente fixture 0');
  await click('Confirmar operación irreversible'); await poll(() => evaluate(`document.querySelectorAll('article').length===3`));
  checks.push('Deletion requires exact customer name and ELIMINAR; order removed after successful response');
  stage = 'account-form'; await navigate('/dashboard/cuenta'); await poll(() => evaluate(`Boolean(document.querySelector('input[type=password]'))`));
  for (const width of [320, 390, 1024, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Account form overflow at ' + width);
  }
  await fill('input[type=password]', 'wrong'); await evaluate(`document.querySelector('form input[type=checkbox]').click()`);
  await fill('form input[autocomplete=off]', 'CERRAR CUENTA'); await click('Cerrar cuenta');
  await poll(() => evaluate(`document.body.textContent.includes('Verifica de nuevo tu identidad.')`));
  assert.equal(await evaluate(`document.querySelector('input[type=password]').value`), '');
  checks.push('Failed reauthentication leaves account form in place and clears the password');
  stage = 'account-success'; await fill('input[type=password]', 'fixture-password');
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });
  await click('Cerrar cuenta'); await poll(() => evaluate(`location.pathname==='/cuenta-cerrada'`));
  assert.equal(await evaluate(`localStorage.getItem('catalogo-session')`), null);
  const cookies = await command('Network.getCookies', { urls: ['http://localhost:4338/'] });
  assert.equal(cookies.cookies.some(cookie => cookie.name === 'catalogo_session'), false);
  assert.ok(await evaluate(`document.body.textContent.includes('limpieza')&&document.body.textContent.includes('no es un borrado completo')`));
  checks.push('Successful closure clears real HttpOnly proxy cookie and local metadata; honest pending-cleanup page');
  for (const width of [320, 390, 1024, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'No overflow at ' + width);
  }
  assert.deepEqual(errors, []); report.success = true;
} catch (error) { report.stage = stage; report.error = error instanceof Error ? error.message : 'CHECK_FAILED'; }
finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close(); if (chrome) chrome.kill(); if (next) next.kill();
  if (api) { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
  report.browserErrors = errors; report.fixtureWrites = writes.length;
  fs.writeFileSync(path.join(os.tmpdir(), 'order-privacy-browser-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('catalog-privacy-browser-'));
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Only the temporary browser profile may need later cleanup. */ }
  if (!report.success) process.exitCode = 1;
}
