import assert from "node:assert/strict";
import test from "node:test";
import { updateCatalogSchema } from "./catalog.schema";

test("accepts optional commercial profile fields and null values for clearing", () => {
  const result = updateCatalogSchema.safeParse({
    phone: "+57 (300) 123-4567",
    address: "Calle 10 #20-30",
    businessHours: "Lun-Vie 9:00-18:00",
    instagramUrl: "https://instagram.com/tienda",
    facebookUrl: "https://facebook.com/tienda",
    tiktokUrl: "https://tiktok.com/@tienda",
    email: "hola@tienda.example",
    mapUrl: "https://maps.google.com/?q=tienda",
  });

  assert.equal(result.success, true);
  assert.equal(updateCatalogSchema.safeParse({ phone: null, address: null, mapUrl: null }).success, true);
});

test("rejects invalid phone numbers, non-HTTP links, and invalid email", () => {
  assert.equal(updateCatalogSchema.safeParse({ phone: "abc" }).success, false);
  assert.equal(updateCatalogSchema.safeParse({ instagramUrl: "javascript:alert(1)" }).success, false);
  assert.equal(updateCatalogSchema.safeParse({ email: "not-an-email" }).success, false);
});