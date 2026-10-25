import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { isIP } from "node:net";
import express, { type Express } from "express";
import { after, before, test } from "node:test";

let app: Express, server: Server, base: string;
before(async () => {
  process.env.JWT_SECRET = "proxy-test-only-secret-at-least-thirty-two-bytes";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "proxy-test-placeholder-not-a-real-key";
  // Same CommonJS/tsx interop boundary used by app.test.ts; inspect the value at runtime.
  const loaded = await import("./app.js") as unknown as { default: Express };
  assert.equal(typeof loaded.default, "function");
  app = loaded.default;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { if (server?.listening) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });

test("API trusts exactly one hop; ignores a forged left prefix and resolves IPv4/IPv6/socket fallback", async () => {
  assert.equal(app.get("trust proxy"), 1);
  const probe = express(); probe.set("trust proxy", app.get("trust proxy"));
  probe.get("/", (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const listener = probe.listen(0, "127.0.0.1"); await once(listener, "listening");
  const address = listener.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const forwarded = await fetch(url, { headers: { "X-Forwarded-For": "198.51.100.7, 203.0.113.10" } });
    assert.deepEqual(await forwarded.json(), { ip: "203.0.113.10", ips: ["203.0.113.10"] });
    const ipv6 = await fetch(url, { headers: { "X-Forwarded-For": "2001:db8::42" } });
    assert.equal((await ipv6.json()).ip, "2001:db8::42");
    const direct = await fetch(url); const body = await direct.json();
    assert.ok(isIP(body.ip)); assert.deepEqual(body.ips, []);
  } finally { listener.closeAllConnections(); await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
});

test("real global limiter still blocks hit 301; forged left addresses do not reset the bucket", async () => {
  const codes: string[] = [], original = console.error;
  console.error = (...items: unknown[]) => { for (const item of items) if (item && typeof item === "object" && "code" in item) codes.push(String(item.code)); };
  try {
    for (let index = 0; index < 300; index++) {
      const response = await fetch(`${base}/api/proxy-regression-no-route`, { headers: { "X-Forwarded-For": `198.51.100.${index % 200 + 1}, 203.0.113.20` } });
      assert.equal(response.status, 404); await response.json();
    }
    const limited = await fetch(`${base}/api/proxy-regression-no-route`, { headers: { "X-Forwarded-For": "192.0.2.99, 203.0.113.20" } });
    assert.equal(limited.status, 429); assert.equal((await limited.json()).error, "RATE_LIMITED");
    const other = await fetch(`${base}/api/proxy-regression-no-route`, { headers: { "X-Forwarded-For": "192.0.2.99, 203.0.113.21" } });
    assert.equal(other.status, 404); await other.json();
    assert.deepEqual(codes, []);
  } finally { console.error = original; }
});

test("real login limiter remains per resolved IP and rejects attempt 11 without querying a database", async () => {
  const login = (ip: string) => fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: "{}" });
  for (let attempt = 0; attempt < 10; attempt++) { const response = await login("203.0.113.30"); assert.equal(response.status, 400); await response.json(); }
  const blocked = await login("203.0.113.30"); assert.equal(blocked.status, 429); await blocked.json();
  const other = await login("203.0.113.31"); assert.equal(other.status, 400); await other.json();
});
