import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const catalog = { publicId: 'measurement', name: 'Fixture local', slug: 'measurement', template: 'TECH', active: true,
  themePreset: null, layoutPreset: null, logoUrl: null, whatsappPhone: null, whatsappMessage: null,
  phone: null, businessHours: null, address: null, email: null, instagramUrl: null, facebookUrl: null,
  tiktokUrl: null, mapUrl: null, description: null, categories: [], products: [], banners: [], featuredProducts: [] };
const api = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ catalog }));
});
let next;
try {
  api.listen(4347, '127.0.0.1'); await once(api, 'listening');
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '4348'], {
    env: { ...process.env, NEXT_PUBLIC_CATALOG_API_URL: 'http://127.0.0.1:4347/api' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  next.stdout.resume(); next.stderr.resume();
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (next.exitCode !== null) throw Error('NEXT_EXITED');
    try { ready = (await fetch('http://127.0.0.1:4348/login')).ok; } catch { /* Wait for local readiness. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'NEXT_NOT_READY');
  const response = await fetch('http://127.0.0.1:4348/c/measurement'); assert.equal(response.status, 200);
  const html = await response.text(); assert.ok(html.includes('Fixture local'));
  const files = [...new Set([...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)]
    .filter(match => match[2].startsWith('/_next/') && !/nomodule/i.test(match[1] + match[3]))
    .map(match => decodeURIComponent(match[2]).replace('/_next/', '.next/')))];
  assert.ok(files.length > 0);
  let bytes = 0, gzip = 0;
  for (const file of files) { const data = fs.readFileSync(file); bytes += data.length; gzip += gzipSync(data).length; }
  const result = { bytes, gzip, chunks: files.length, method: 'Sum of individually gzipped initial script files; Webpack; loopback fixture', productionAccess: false };
  const stage = process.argv.includes('--before') ? 'before' : 'after';
  fs.writeFileSync(path.join(os.tmpdir(), `account-navigation-public-${stage}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (next) next.kill(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
}
