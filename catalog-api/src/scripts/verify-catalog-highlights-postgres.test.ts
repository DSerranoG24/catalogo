import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("highlights rehearsal rejects remote/ambiguous targets before connecting and never echoes credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-highlights-guard-"));
  const output = path.join(directory, "catalog-highlights-postgres-results.json");
  try {
    for (const uri of [
      "postgresql://CANARY_SECRET@db.example.invalid/catalogo_test",
      "postgresql://CANARY_SECRET@127.0.0.1/production",
      "postgresql://CANARY_SECRET@127.0.0.1/catalogo_test?host=db.example.invalid",
      "postgresql://CANARY_SECRET@127.0.0.1/catalogo_test?options=CANARY_SECRET",
      "postgresql://CANARY_SECRET@127.0.0.1/catalogo_test#CANARY_SECRET",
      "https://CANARY_SECRET@127.0.0.1/catalogo_test",
      "CANARY_SECRET_NOT_A_URI",
    ]) {
      const child = spawnSync(process.execPath, ["--require", path.resolve(__dirname, "../../scripts/test.cjs"), require.resolve("tsx/cli"), path.resolve(__dirname, "verify-catalog-highlights-postgres.ts"), output], {
        cwd: directory, input: uri, encoding: "utf8", timeout: 15000, windowsHide: true,
      });
      assert.equal(child.status, 1);
      assert.doesNotMatch(child.stdout + child.stderr, /CANARY_SECRET|db\.example|postgresql:\/\//);
      const report = JSON.parse(await readFile(output, "utf8"));
      assert.equal(report.success, false); assert.equal(report.failedStage, "INPUT_VALIDATION");
      assert.equal(report.cleanup, true); assert.equal(report.isolatedSchema, null);
    }
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("catalog-highlights-guard-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
