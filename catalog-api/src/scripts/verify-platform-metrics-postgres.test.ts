import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("PostgreSQL metrics verifier rejects remote/ambiguous targets before connecting and never echoes input", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "metrics-guard-test-"));
  try {
    for (const uri of [
      "postgresql://CANARY_SECRET@db.example.invalid/catalogo_test",
      "postgresql://CANARY_SECRET@127.0.0.1/production",
      "postgresql://CANARY_SECRET@127.0.0.1/catalogo_test?host=db.example.invalid",
      "postgresql://CANARY_SECRET@127.0.0.1/catalogo_test?options=CANARY_SECRET",
      "https://CANARY_SECRET@127.0.0.1/catalogo_test",
      "CANARY_SECRET_NOT_A_URI",
    ]) {
      const child = spawnSync(process.execPath, ["--require", path.resolve(__dirname, "../../scripts/test.cjs"), require.resolve("tsx/cli"), path.resolve(__dirname, "verify-platform-metrics-postgres.ts")], {
        cwd: directory, input: uri, encoding: "utf8", timeout: 15000,
      });
      assert.equal(child.status, 1);
      assert.doesNotMatch(child.stdout + child.stderr, /CANARY_SECRET|db\.example|postgresql:\/\//);
      const report = JSON.parse(await readFile(path.join(directory, "platform-metrics-postgres-results.json"), "utf8"));
      assert.equal(report.success, false);
      assert.equal(report.failedStage, "INPUT_VALIDATION");
      assert.equal(report.cleanup, true);
      assert.deepEqual(report.plans, []);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
