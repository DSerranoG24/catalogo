import assert from "node:assert/strict";
import test from "node:test";
import { inventoryTestTarget } from "./verify-inventory-postgres";

test("inventory rehearsal rejects nonlocal, ambiguous or nontest databases before connecting", async () => {
  for (const value of [
    "postgresql://example.invalid/catalogo_test",
    "postgresql://127.0.0.1/catalogo",
    "postgresql://127.0.0.1/catalogo_test?host=example.invalid",
    "postgresql://127.0.0.1/catalogo_test#fragment",
    "https://127.0.0.1/catalogo_test",
    "not-a-url",
  ]) await assert.rejects(inventoryTestTarget(value));
  const local = await inventoryTestTarget("postgresql://127.0.0.1:55439/catalogo_test");
  assert.equal(local.pathname, "/catalogo_test");
});
