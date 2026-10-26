import assert from "node:assert/strict";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export async function measureSettingsJavaScript(base) {
  const response = await fetch(`${base}/dashboard/catalogos/local-catalog`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const scripts = [...new Set([...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)]
    .filter(m => m[2].startsWith("/_next/") && !/nomodule/i.test(m[1] + m[3])).map(m => m[2]))];
  const weight = scripts.reduce((sum, url) => {
    const data = fs.readFileSync(".next" + url.replace("/_next", ""));
    return { bytes: sum.bytes + data.length, gzip: sum.gzip + gzipSync(data).length };
  }, { bytes: 0, gzip: 0 });
  return { ...weight, scripts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const base = "http://127.0.0.1:4342";
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "4342"], {
    env: { ...process.env, NEXT_PUBLIC_CATALOG_API_URL: "https://127.0.0.1:4317/api" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume(); child.stderr.resume();
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(base + "/login", { signal: AbortSignal.timeout(500) })).ok; } catch { /* Wait for local Next readiness. */ }
      if (ready) break;
      assert.equal(child.exitCode, null);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Local Next readiness");
    const result = await measureSettingsJavaScript(base);
    const outputAt = process.argv.indexOf("--output");
    if (outputAt >= 0) fs.writeFileSync(process.argv[outputAt + 1], JSON.stringify(result));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } }
}
