import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), { WebSocket } = require('next/dist/compiled/ws');
export async function privatePanelFixture(handler, run) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-bulk-browser-'));
  let api, next, chrome, socket, sequence = 0;
  const pending = new Map(), errors = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function poll(work) { for (let i = 0; i < 250; i++) { if (await work()) return; await pause(60); } throw Error('FIXTURE_TIMEOUT'); }
  function command(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP_TIMEOUT:' + method)); }, 15000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description?.split('\n')[0] ?? 'BROWSER_EVALUATION_FAILED'); return result.result.value; }
  async function click(text) { assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`), 'BUTTON_NOT_AVAILABLE:' + text); }
  async function fill(selector, text) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`); await command('Input.insertText', { text }); }
  try {
    const pem = execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', '-', '-out', '-', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const cert = pem.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0], key = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0]; assert.ok(cert && key);
    const ca = path.join(folder, 'localhost-cert.pem'); fs.writeFileSync(ca, cert);
    api = https.createServer({ key, cert }, (req, res) => { void handler(req, res).catch(() => { res.writeHead(500); res.end('{}'); }); });
    api.listen(4339, '127.0.0.1'); await once(api, 'listening');
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
    const result = await run({ command, evaluate, poll, click, fill }); assert.deepEqual(errors, []); return result;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close(); if (chrome) chrome.kill(); if (next) next.kill();
    if (api) { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
    const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('catalog-bulk-browser-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Temporary isolated profile may still be releasing files. */ }
  }
}
