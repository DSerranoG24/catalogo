import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogSchema, updateCatalogSchema } from "./catalog.schema";

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

test("theme presets accept only curated identifiers, null and omission on create/update", () => {
  for (const schema of [updateCatalogSchema, createCatalogSchema]) {
    const base = { name: "Local", slug: "local" };
    assert.equal(Object.hasOwn(schema.parse(base), "themePreset"), false);
    assert.equal(schema.parse({ ...base, themePreset: null }).themePreset, null);
    for (const themePreset of ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber"]) {
      assert.equal(schema.parse({ ...base, themePreset }).themePreset, themePreset);
    }
    for (const themePreset of ["unknown", "", "#FFFFFF", {}, 1, "__proto__"]) {
      assert.equal(schema.safeParse({ ...base, themePreset }).success, false);
    }
  }
});
