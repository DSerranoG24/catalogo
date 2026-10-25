import assert from "node:assert/strict";
import { test } from "node:test";
import { quotationCatalogFieldsSchema, updateCatalogSchema } from "./catalog.schema";
import { updateCatalog } from "../repositories/catalog.repository";

test("NIT and quotation terms accept null and bounded text, and reject invalid input", () => {
  assert.deepEqual(quotationCatalogFieldsSchema.parse({ nit: " 900.123.456-7 ", quotationTerms: " Entrega y garantía " }), { nit: "900.123.456-7", quotationTerms: "Entrega y garantía" });
  assert.ok(updateCatalogSchema.safeParse({ nit: null, quotationTerms: null }).success);
  for (const input of [{ nit: "invalid" }, { nit: "1".repeat(31) }, { quotationTerms: "x".repeat(4001) }]) {
    assert.equal(quotationCatalogFieldsSchema.safeParse(input).success, false);
  }
});
test("repository validates quotation fields before writing, even without a controller", async () => {
  await assert.rejects(updateCatalog("catalog", "owner", { quotationTerms: "x".repeat(4001) }));
});
