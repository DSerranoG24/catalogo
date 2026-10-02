import assert from "node:assert/strict";
import { once } from "node:events";
import { Server } from "node:http";
import { Express } from "express";
import { after, before, test } from "node:test";

let server: Server;
let baseUrl: string;

before(async () => {
  process.env.JWT_SECRET ||= "integration-test-secret";
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY ||= "integration-test-key";

  const { default: app } = await import("./app.js") as unknown as { default: Express };
  server = app.listen(0);
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("unknown routes return the API 404 contract", async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: "ROUTE_NOT_FOUND" });
});

test("administrative routes reject missing and invalid JWTs", async () => {
  const missingToken = await fetch(`${baseUrl}/api/products`);
  assert.equal(missingToken.status, 401);

  const invalidToken = await fetch(`${baseUrl}/api/products`, {
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert.equal(invalidToken.status, 401);
});

test("malformed JSON receives a controlled client error", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: "INVALID_REQUEST_BODY" });
});