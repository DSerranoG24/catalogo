import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createQuotationController } from "./quotation.controller";
import { generateQuotationPdf } from "../services/quotation-pdf";
import { findQuotation, quotationStillAccessible } from "../repositories/quotation.repository";
import { prisma } from "../config/prisma";
import { Prisma } from "@prisma/client";

const publicId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(64);
const seller = { name: "Nombre congelado", nit: null, phone: null, whatsappPhone: null,
  address: null, businessHours: null, email: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, quotationTerms: "Condiciones congeladas" };
const order = { id: orderId, catalogId: "catalog", quotationNumber: 1, quotationIssuedAt: new Date("2026-10-24T15:00:00Z"),
  quotationSellerSnapshot: seller, customerName: "Cliente de prueba", customerPhone: "3000000000", customerAddress: "Dirección de prueba",
  total: 100, items: [{ productName: "Producto", quantity: 1, unitPrice: 100, subtotal: 100 }], catalog: { logoUrl: null } };

test("PDF endpoint enforces capability, safe headers and cancellation recheck", async () => {
  let cancelled = false;
  let cancelDuringRendering = false;
  let reads = 0;
  const app = express();
  app.get("/catalogs/:publicId/orders/:orderId/quotation.pdf", createQuotationController({
    find: async (catalog, id, suppliedToken) => {
      reads++;
      return !cancelled && catalog === publicId && id === orderId && suppliedToken === token ? order : null;
    },
    stillAccessible: async () => !cancelled,
    logo: async () => undefined,
    pdf: async data => {
      assert.equal(data.seller.name, "Nombre congelado");
      assert.equal(data.seller.quotationTerms, "Condiciones congeladas");
      if (cancelDuringRendering) cancelled = true;
      return generateQuotationPdf(data);
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/catalogs`;
  const url = `${base}/${publicId}/orders/${orderId}/quotation.pdf`;
  try {
    assert.equal((await fetch(url)).status, 404);
    assert.equal(reads, 0, "Malformed capability is rejected before data access");
    assert.equal((await fetch(`${url}?token=${"b".repeat(64)}`)).status, 404);
    assert.equal((await fetch(`${base}/${orderId}/orders/${orderId}/quotation.pdf?token=${token}`)).status, 404);
    const response = await fetch(`${url}?token=${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(response.headers.get("content-disposition"), 'inline; filename="COT-000001.pdf"');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(bytes.toString("latin1").includes("%%EOF"));
    cancelDuringRendering = true;
    assert.equal((await fetch(`${url}?token=${token}`)).status, 404);
    assert.equal((await fetch(`${url}?token=${token}`)).status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test("anonymization during PDF rendering is rejected by the final repository access check", async () => {
  let anonymized = false;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "order") return { findFirst: async (args: Prisma.OrderFindFirstArgs) => {
      assert.equal(args.where?.anonymizedAt, null);
      return anonymized ? null : order;
    } };
    throw new Error("Unexpected persistence call");
  } });
  const app = express();
  app.get("/:publicId/:orderId", createQuotationController({
    find: (catalog, id, key) => findQuotation(catalog, id, key, database),
    stillAccessible: (catalog, id, key) => quotationStillAccessible(catalog, id, key, database),
    logo: async () => undefined,
    pdf: async data => { const bytes = await generateQuotationPdf(data); anonymized = true; return bytes; },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/${publicId}/${orderId}?token=${token}`);
    assert.equal(response.status, 404);
    assert.ok(!(response.headers.get("content-type") ?? "").includes("application/pdf"));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
