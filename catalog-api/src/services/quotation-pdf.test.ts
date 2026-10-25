import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { generateQuotationPdf, QuotationDocument } from "./quotation-pdf";
import { quotationBaseUrl, quotationLabel, quotationUrl } from "./quotation-data";
import { loadCurrentQuotationLogo } from "./quotation-logo";

export const quotationFixture: QuotationDocument = {
  number: 123, issuedAt: new Date("2026-10-24T15:00:00Z"),
  seller: { name: "Negocio inicial", nit: "900123456-7", phone: "3000000000", whatsappPhone: "+573000000000",
    address: "Dirección comercial de prueba", businessHours: "Lunes a viernes", email: "prueba@example.invalid",
    instagramUrl: "https://instagram.com/prueba", facebookUrl: null, tiktokUrl: null,
    quotationTerms: "Garantía y entrega según condiciones iniciales." },
  customerName: "Cliente de prueba", customerPhone: "3000000001", customerAddress: "Dirección de prueba",
  total: 5000, items: [{ productName: "Producto original", quantity: 2, unitPrice: 2500, subtotal: 5000 }],
};

function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try {
      const content = inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1");
      return [...content.matchAll(/<([0-9a-f]+)>/gi)].map(m => Buffer.from(m[1] ?? "", "hex").toString("latin1")).join("");
    } catch { return ""; }
  }).join("\n");
}

test("quotation PDF contains persisted seller, customer, line prices, total and fixed validity", async () => {
  const pdf = await generateQuotationPdf(quotationFixture);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.toString("latin1").includes("%%EOF"));
  const text = extractPdfText(pdf);
  for (const value of ["COT-000123", "Solicitud sujeta a confirmaci", "15", "Negocio inicial", "900123456-7", "Cliente de prueba", "Producto original", "2.500 COP", "5.000 COP", "Garant"]) {
    assert.ok(text.includes(value), `Missing PDF text: ${value}`);
  }
  assert.ok(text.includes("10:00"), "The emission time is rendered in America/Bogota");
});

test("quotation PDF paginates long orders and conditions without requiring NIT or logo", async () => {
  const pdf = await generateQuotationPdf({ ...quotationFixture, seller: { ...quotationFixture.seller, nit: null, quotationTerms: "Condiciones extensas de entrega y pago. ".repeat(100) },
    items: Array.from({ length: 50 }, (_, i) => ({ productName: `Producto ${i} con nombre largo para verificar los saltos de página`, quantity: 1, unitPrice: 100, subtotal: 100 })) });
  assert.ok((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length > 1);
  const text = extractPdfText(pdf);
  assert.ok(text.includes("Producto 49"));
  assert.ok(text.includes("Condiciones extensas"));
  assert.ok(!text.includes("NIT:"));
});

test("quotation labels and links are server-built and reject unsafe public base URLs", () => {
  const previous = process.env.PUBLIC_API_URL;
  try {
    process.env.PUBLIC_API_URL = "https://api.example.invalid/api";
    const url = new URL(quotationUrl(quotationBaseUrl(), "catalog", "order", "a".repeat(64)));
    assert.equal(url.pathname, "/api/public/catalogs/catalog/orders/order/quotation.pdf");
    assert.equal(url.searchParams.get("token")?.length, 64);
    assert.equal(quotationLabel(1234567), "COT-1234567");
    assert.throws(() => quotationLabel(0));
    process.env.PUBLIC_API_URL = "https://user:password@example.invalid/api";
    assert.throws(() => quotationBaseUrl());
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previous;
  }
});

test("WebP and non-branding paths are omitted without any storage request", async () => {
  let calls = 0;
  const noFetch: typeof fetch = async () => { calls++; throw new Error("Unexpected network"); };
  assert.equal(await loadCurrentQuotationLogo("catalog", "catalog/branding/logo.webp", noFetch), undefined);
  assert.equal(await loadCurrentQuotationLogo("catalog", "other/branding/logo.png", noFetch), undefined);
  assert.equal(await loadCurrentQuotationLogo("catalog", "catalog/branding/../logo.png", noFetch), undefined);
  assert.equal(calls, 0);
});

test("current PNG is downloaded as bytes and embedded; oversized or non-image logos are omitted", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "local-test-placeholder";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=", "base64");
  try {
    const fetcher: typeof fetch = async (url, options) => {
      assert.ok(String(url).endsWith("/object/authenticated/product-images/catalog/branding/logo.png"));
      assert.equal(options?.redirect, "error");
      return new Response(png);
    };
    const logo = await loadCurrentQuotationLogo("catalog", "catalog/branding/logo.png", fetcher);
    assert.deepEqual(logo, png);
    const pdf = await generateQuotationPdf(quotationFixture, logo);
    assert.ok(pdf.toString("latin1").includes("/Subtype /Image"));
    const large: typeof fetch = async () => new Response("unused", { headers: { "content-length": String(6 * 1024 * 1024) } });
    assert.equal(await loadCurrentQuotationLogo("catalog", "catalog/branding/logo.png", large), undefined);
    const html: typeof fetch = async () => new Response("<html>not an image</html>");
    assert.equal(await loadCurrentQuotationLogo("catalog", "catalog/branding/logo.png", html), undefined);
    const corruptPng = Buffer.from(png);
    corruptPng.fill(0, 41, 45);
    const corrupt: typeof fetch = async () => new Response(corruptPng);
    assert.equal(await loadCurrentQuotationLogo("catalog", "catalog/branding/logo.png", corrupt), undefined);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
