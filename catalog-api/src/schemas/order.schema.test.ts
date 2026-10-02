import assert from "node:assert/strict";
import test from "node:test";
import { createPublicOrderSchema } from "./order.schema";

const productId = "00000000-0000-4000-8000-000000000001";
const validOrder = {
  customerName: "Ana Pérez",
  customerPhone: "+573001234567",
  customerAddress: "Calle 10 # 20-30, Bogotá",
  consent: true,
  items: [{ productId, quantity: 2 }],
};

test("accepts a bounded public order and ignores client prices", () => {
  const result = createPublicOrderSchema.safeParse({
    ...validOrder,
    items: [{ productId, quantity: 2, unitPrice: 1, subtotal: 2 }],
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal("unitPrice" in result.data.items[0], false);
    assert.equal("subtotal" in result.data.items[0], false);
  }
});

test("rejects duplicate products and out-of-range quantities", () => {
  assert.equal(createPublicOrderSchema.safeParse({
    ...validOrder,
    items: [{ productId, quantity: 1 }, { productId, quantity: 1 }],
  }).success, false);
  assert.equal(createPublicOrderSchema.safeParse({
    ...validOrder,
    items: [{ productId, quantity: 100 }],
  }).success, false);
});

test("requires a deliverable address and a plausible phone", () => {
  assert.equal(createPublicOrderSchema.safeParse({ ...validOrder, customerAddress: "x" }).success, false);
  assert.equal(createPublicOrderSchema.safeParse({ ...validOrder, customerPhone: "abc" }).success, false);
});

test("requires explicit consent before retaining customer data", () => {
  const { consent: _consent, ...withoutConsent } = validOrder;
  assert.equal(createPublicOrderSchema.safeParse(withoutConsent).success, false);
  assert.equal(createPublicOrderSchema.safeParse({ ...validOrder, consent: false }).success, false);
});
