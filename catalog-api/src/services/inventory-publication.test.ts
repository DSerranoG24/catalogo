import assert from "node:assert/strict";
import test from "node:test";
import { makeInventoryPublicationService } from "./inventory-publication.service";

test("selective publication allocates a catalog-local slug suffix", async () => {
  const slugs: string[] = ["abc-item"];
  let createdPrice: number | undefined;
  const tx: any = {
    $queryRaw: async () => [{ id: "owner" }],
    inventoryItem: { findFirst: async () => ({ id: "item", sku: "ABC", name: "Cable", stock: 7, commercialTerms: { unitSalePrice: 1000n }, images: [] }) },
    catalog: { findFirst: async () => ({ id: "catalog" }) },
    product: { findFirst: async ({ where }: any) => slugs.includes(where.slug) ? { id: "existing" } : null, create: async ({ data }: any) => { slugs.push(data.slug); createdPrice = data.price; return { id: "product" }; } },
    inventoryPublication: { create: async ({ data }: any) => data },
  };
  const service = makeInventoryPublicationService({ $transaction: async (fn: any) => fn(tx) } as any);
  const result = await service.publish("owner", { inventoryItemId: "item", catalogId: "catalog", operationId: "op", priceOverride: null, titleOverride: null, descriptionOverride: null } as any);
  assert.equal(result.productId, "product");
  assert.equal(slugs[1], "abc-item-2");
  assert.equal(createdPrice, 1000);
});

function updateFixture(priceOverride: number | null = 800) {
  const state = { publication: { id: "publication", userId: "owner", productId: "product", status: "PUBLISHED", version: 1, priceOverride }, product: { id: "product", price: priceOverride ?? 1000, active: true } };
  const tx: any = {
    $queryRaw: async () => [{ id: "owner" }],
    inventoryPublication: {
      findFirst: async () => ({ ...state.publication, item: { id: "item", name: "Cable", stock: 4, commercialTerms: { unitSalePrice: 1000n } }, product: { ...state.product } }),
      update: async ({ data }: any) => { if ("priceOverride" in data) state.publication.priceOverride = data.priceOverride; if (data.status !== undefined) state.publication.status = data.status; state.publication.version++; return { ...state.publication }; },
    },
    product: { update: async ({ data }: any) => { if ("price" in data) state.product.price = data.price; if (data.active !== undefined) state.product.active = data.active; return { ...state.product }; } },
  };
  return { state, service: makeInventoryPublicationService({ $transaction: async (fn: any) => fn(tx) } as any) };
}

test("status changes preserve the persisted override and materialized product price", async () => {
  const fixture = updateFixture(800);
  await fixture.service.update("owner", "publication", { operationId: "op-1", expectedVersion: 1, status: "UNPUBLISHED" } as any);
  assert.equal(fixture.state.publication.priceOverride, 800);
  assert.equal(fixture.state.product.price, 800);
  await fixture.service.update("owner", "publication", { operationId: "op-2", expectedVersion: 2, status: "PUBLISHED" } as any);
  assert.equal(fixture.state.publication.priceOverride, 800);
  assert.equal(fixture.state.product.price, 800);
});

test("explicit null restores the inventory base and a new integer replaces the override", async () => {
  const fixture = updateFixture(800);
  await fixture.service.update("owner", "publication", { operationId: "op-1", expectedVersion: 1, priceOverride: null, status: "PUBLISHED" } as any);
  assert.equal(fixture.state.publication.priceOverride, null);
  assert.equal(fixture.state.product.price, 1000);
  await fixture.service.update("owner", "publication", { operationId: "op-2", expectedVersion: 2, priceOverride: 1200, status: "PUBLISHED" } as any);
  assert.equal(fixture.state.publication.priceOverride, 1200);
  assert.equal(fixture.state.product.price, 1200);
});

