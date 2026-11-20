import assert from "node:assert/strict";
import test from "node:test";
import { makeInventoryPublicationService } from "./inventory-publication.service";

test("selective publication allocates a catalog-local slug suffix", async () => {
  const slugs: string[] = ["abc-item"];
  const tx: any = {
    $queryRaw: async () => [{ id: "owner" }],
    inventoryItem: { findFirst: async () => ({ id: "item", sku: "ABC", name: "Cable", stock: 7, commercialTerms: { unitSalePrice: 1000n }, images: [] }) },
    catalog: { findFirst: async () => ({ id: "catalog" }) },
    product: { findFirst: async ({ where }: any) => slugs.includes(where.slug) ? { id: "existing" } : null, create: async ({ data }: any) => { slugs.push(data.slug); return { id: "product" }; } },
    inventoryPublication: { create: async ({ data }: any) => data },
  };
  const service = makeInventoryPublicationService({ $transaction: async (fn: any) => fn(tx) } as any);
  const result = await service.publish("owner", { inventoryItemId: "item", catalogId: "catalog", operationId: "op", priceOverride: null, titleOverride: null, descriptionOverride: null, productId: null } as any);
  assert.equal(result.productId, "product");
  assert.equal(slugs[1], "abc-item-2");
});

