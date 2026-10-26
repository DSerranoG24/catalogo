import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { accountMailer, createActionDispatcher } from "./account-mail.service";
import { createActionToken } from "./account-action";

const settings = {
  NODE_ENV: "production", MAIL_MODE: "brevo", BREVO_API_KEY: "test-only-brevo-key",
  BREVO_SENDER_EMAIL: "sender@example.invalid", BREVO_SENDER_NAME: "Test Brand",
  MAIL_FROM: "Test Brand <sender@example.invalid>", APP_PUBLIC_URL: "https://app.example.invalid",
};
async function isolated(fetcher: typeof fetch, work: () => Promise<void>, overrides: Partial<Record<keyof typeof settings, string | undefined>> = {}) {
  const saved = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries({ ...settings, ...overrides })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  globalThis.fetch = fetcher;
  try { await work(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
const mail = () => ({ purpose: "VERIFY_EMAIL" as const, to: "recipient@example.invalid", token: createActionToken() });
const genericFailure = (error: unknown) => error instanceof Error && error.message === "MAIL_DELIVERY_FAILED";

test("Brevo HTTP acceptance preserves plain-text templates, fixed endpoint, headers, sender and abort signal", async () => {
  let calls = 0;
  await isolated(async (url, options) => {
    calls++;
    assert.equal(url, "https://api.brevo.com/v3/smtp/email"); assert.equal(options?.method, "POST"); assert.equal(options.redirect, "error");
    const headers = new Headers(options.headers);
    assert.ok(headers.get("api-key") === settings.BREVO_API_KEY);
    assert.equal(headers.get("content-type"), "application/json"); assert.equal(headers.get("accept"), "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(typeof options.body, "string");
    const body = z.object({ sender: z.object({ name: z.string(), email: z.string() }), to: z.array(z.object({ email: z.string() })), replyTo: z.object({ email: z.string() }), subject: z.string(), textContent: z.string() }).parse(JSON.parse(String(options.body)));
    assert.deepEqual(body.sender, { name: "Test Brand", email: "sender@example.invalid" });
    assert.equal(body.to.length, 1); assert.equal(body.to[0].email, "recipient@example.invalid");
    assert.ok(body.replyTo.email.length > 0);
    assert.ok(body.textContent.includes("https://app.example.invalid/"));
    assert.ok(body.textContent.includes(calls === 1 ? "/verificar-correo#token=" : "/restablecer-contrasena#token="));
    assert.ok(body.textContent.includes(calls === 1 ? "24 horas" : "30 minutos"));
    assert.equal(body.subject, calls === 1 ? "Verifica tu correo en Vitrinaya" : "Recupera tu acceso a Vitrinaya");
    return Response.json({ messageId: "test-message-id" }, { status: 201 });
  }, async () => {
    await accountMailer.send(mail()); await accountMailer.send({ ...mail(), purpose: "RESET_PASSWORD" });
  });
  assert.equal(calls, 2);
});

test("provider HTTP errors, malformed acceptance and network errors expose only a generic failure", async () => {
  for (const status of [401, 429, 500]) await isolated(async () => new Response("private-provider-details", { status }), async () => {
    await assert.rejects(accountMailer.send(mail()), genericFailure);
  });
  await isolated(async () => Response.json({ invalid: "private-provider-details" }, { status: 201 }), async () => {
    await assert.rejects(accountMailer.send(mail()), genericFailure);
  });
  await isolated(async () => { throw new Error("private-network-details"); }, async () => {
    await assert.rejects(accountMailer.send(mail()), genericFailure);
  });
});

test("eight-second timeout is attached to fetch and abort remains a generic mail failure", async () => {
  const originalTimeout = AbortSignal.timeout;
  let duration = 0;
  AbortSignal.timeout = milliseconds => { duration = milliseconds; return AbortSignal.abort(new DOMException("test-timeout", "TimeoutError")); };
  try {
    await isolated(async (_url, options) => { assert.ok(options?.signal?.aborted); throw options.signal.reason; }, async () => {
      await assert.rejects(accountMailer.send(mail()), genericFailure);
    });
    assert.equal(duration, 8000);
  } finally { AbortSignal.timeout = originalTimeout; }
});

test("MAIL_FROM must match the structured sender; absent MAIL_FROM is allowed", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ messageId: "test-message-id" }, { status: 201 }); };
  await isolated(fetcher, async () => { await assert.rejects(accountMailer.send(mail()), /MAIL_NOT_CONFIGURED/); }, { MAIL_FROM: "Other <other@example.invalid>" });
  assert.equal(calls, 0);
  await isolated(fetcher, async () => { await accountMailer.send(mail()); }, { MAIL_FROM: undefined });
  assert.equal(calls, 1);
});

test("missing Brevo key fails without network and dispatcher contains the failure while continuing other work", { timeout: 3000 }, async () => {
  let calls = 0;
  await isolated(async () => { calls++; throw new Error("NETWORK_FORBIDDEN"); }, async () => {
    await assert.rejects(accountMailer.send(mail()), /MAIL_NOT_CONFIGURED/);
    const originalWarn = console.warn; const logs: unknown[][] = [];
    try {
      await new Promise<void>(resolve => {
        let failed = false, continued = false;
        const finish = () => { if (failed && continued) resolve(); };
        console.warn = (...args: unknown[]) => { logs.push(args); failed = true; finish(); };
        const dispatcher = createActionDispatcher();
        assert.equal(dispatcher.enqueue("VERIFY_EMAIL", () => accountMailer.send(mail())), true);
        assert.equal(dispatcher.enqueue("RESET_PASSWORD", async () => { continued = true; finish(); }), true);
      });
    } finally { console.warn = originalWarn; }
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "CONFIG_MISSING" }]);
  }, { BREVO_API_KEY: undefined });
  assert.equal(calls, 0);
});

test("invalid modes and non-production real mail cannot contact Brevo", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("NETWORK_FORBIDDEN"); };
  await isolated(fetcher, async () => { await assert.rejects(accountMailer.send(mail()), /MAIL_NOT_CONFIGURED/); }, { MAIL_MODE: "unsupported-provider" });
  await isolated(fetcher, async () => { await assert.rejects(accountMailer.send(mail()), /REAL_MAIL_DISABLED_IN_DEVELOPMENT/); }, { NODE_ENV: "development" });
  assert.equal(calls, 0);
});

async function failureLog(fetcher: typeof fetch, overrides: Partial<Record<keyof typeof settings, string | undefined>> = {}) {
  let log: unknown[] = [];
  await isolated(fetcher, async () => {
    const originalWarn = console.warn;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("EXPECTED_MAIL_FAILURE_LOG")), 2000);
        console.warn = (...args: unknown[]) => { log = args; resolve(); };
        createActionDispatcher().enqueue("VERIFY_EMAIL", () => accountMailer.send(mail()));
      });
    } finally { if (timer) clearTimeout(timer); console.warn = originalWarn; }
  }, overrides);
  return log;
}

test("dispatcher logs CONFIG_MISSING for absent key/sender/origin without network", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("NETWORK_FORBIDDEN"); };
  for (const overrides of [{ BREVO_API_KEY: undefined }, { BREVO_SENDER_EMAIL: undefined }, { BREVO_SENDER_NAME: undefined }, { APP_PUBLIC_URL: undefined }]) {
    assert.deepEqual(await failureLog(fetcher, overrides), ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "CONFIG_MISSING" }]);
  }
  assert.equal(calls, 0);
});

test("dispatcher logs CONFIG_MISMATCH for contradictory MAIL_FROM without network", async () => {
  let calls = 0;
  const log = await failureLog(async () => { calls++; throw new Error("NETWORK_FORBIDDEN"); }, { MAIL_FROM: "Other <other@example.invalid>" });
  assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "CONFIG_MISMATCH" }]);
  assert.equal(calls, 0);
});

test("dispatcher logs NETWORK without exception text or stack", async () => {
  const log = await failureLog(async () => { throw new Error("private exception with recipient, key and token"); });
  assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "NETWORK" }]);
});

test("dispatcher logs TIMEOUT when its timeout signal aborts", async () => {
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => AbortSignal.abort(new DOMException("private-timeout-details", "TimeoutError"));
  try {
    const log = await failureLog(async (_url, options) => { assert.ok(options?.signal?.aborted); throw options.signal.reason; });
    assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "TIMEOUT" }]);
  } finally { AbortSignal.timeout = originalTimeout; }
});

for (const [status, reason] of [[401, "HTTP_401"], [403, "HTTP_403"], [400, "HTTP_400"], [429, "HTTP_4xx"], [503, "HTTP_5xx"]] as const) {
  test(`dispatcher logs ${reason} for HTTP ${status}`, async () => {
    const log = await failureLog(async () => new Response("private provider body", { status }));
    assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason }]);
  });
}

test("dispatcher logs RESPONSE_INVALID for malformed JSON or missing messageId", async () => {
  for (const body of ["not-json", JSON.stringify({ unexpected: "private-body" })]) {
    const log = await failureLog(async () => new Response(body, { status: 201 }));
    assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "RESPONSE_INVALID" }]);
  }
});

test("only allowlisted provider code reaches logs, never response body, key, recipient or token", async () => {
  const secretCanary = "private-body-canary";
  const log = await failureLog(async (_url, options) => {
    const body = z.object({ to: z.array(z.object({ email: z.string() })), textContent: z.string() }).parse(JSON.parse(String(options?.body)));
    return Response.json({ code: "unauthorized", message: secretCanary, recipient: body.to[0].email, key: new Headers(options?.headers).get("api-key"), linkWithToken: body.textContent }, { status: 401 });
  });
  assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "HTTP_401", code: "unauthorized" }]);
  assert.ok(!JSON.stringify(log).includes(secretCanary)); assert.ok(!JSON.stringify(log).includes(settings.BREVO_API_KEY));
  for (const code of ["recipient@example.invalid", "#token=private", "unknown_short_code", "unauthorized\nprivate", { nested: "unauthorized" }]) {
    const unsafe = await failureLog(async () => Response.json({ code, message: secretCanary }, { status: 403 }));
    assert.deepEqual(unsafe, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "HTTP_403" }]);
  }
});

test("oversized error body is cancelled and its HTTP category survives", async () => {
  let cancelled = false;
  const log = await failureLog(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ code: "unauthorized", message: "x".repeat(5000) }))); },
    cancel() { cancelled = true; },
  }), { status: 401 }));
  assert.equal(cancelled, true);
  assert.deepEqual(log, ["[account-mail]", { operation: "VERIFY_EMAIL", result: "failed", reason: "HTTP_401" }]);
});
