import assert from "node:assert/strict";
import test from "node:test";
import { calculatePublicOrder } from "./order-calculation";
import { createPublicOrderSchema } from "../schemas/order.schema";

const productId = "00000000-0000-4000-8000-000000000001";

test("client prices are ignored and order totals use current server product prices", () => {
  const parsed = createPublicOrderSchema.safeParse({
    customerName: "Ana",
    customerPhone: "3001234567",
    customerAddress: "Calle 10 # 20-30",
    consent: true,
    items: [{ productId, quantity: 2, unitPrice: 1, subtotal: 2 }],
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  const result = calculatePublicOrder(
    parsed.data.items,
    [{ id: productId, name: "Item", price: 700, salePrice: null, saleStartsAt: null, saleEndsAt: null }],
    new Date("2026-10-23T12:00:00.000Z")
  );

  assert.equal(result.total, 1400);
  assert.equal(result.items[0].unitPrice, 700);
  assert.equal("unitPrice" in parsed.data.items[0], false);
});
