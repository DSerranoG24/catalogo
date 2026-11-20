import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import { inventoryTestTarget } from "./verify-inventory-postgres";

async function main() {
  let input = ""; for await (const chunk of process.stdin) input += String(chunk);
  const target = await inventoryTestTarget(input.trim()); target.searchParams.set("schema", `workbook_http_${randomUUID().replace(/-/g, "")}`);
  process.env.DATABASE_URL = target.toString(); process.env.JWT_SECRET = "workbook-http-test-secret-with-32-bytes"; process.env.NODE_ENV = "test";
  const db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  const appModule = await import("../app.js"); const app = appModule.default as unknown as import("express").Express; const { generateToken } = await import("../utils/jwt.js");
  const server = app.listen(0); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  try {
    const owner = await db.user.create({ data: { email: `http-owner-${randomUUID()}@example.invalid` } });
    const other = await db.user.create({ data: { email: `http-other-${randomUUID()}@example.invalid` } });
    const item = await db.inventoryItem.create({ data: { userId: owner.id, name: "Contado", sku: "HTTP-001", stock: 8 } });
    const snapshot = JSON.stringify({ id: "vitrinaya-workbook", name: "HTTP", sheetOrder: ["sheet"], sheets: { sheet: { id: "sheet", name: "Hoja", rowCount: 10, columnCount: 3, cellData: { 0: { 0: { v: "SKU" }, 1: { v: "Nombre" }, 2: { v: "Cantidad" } }, 1: { 0: { v: item.sku }, 1: { v: item.name }, 2: { v: 0 } } } } } });
    await db.inventoryWorkbook.create({ data: { userId: owner.id, snapshot } });
    const token = generateToken({ userId: owner.id, email: owner.email });
    const body = { workbookId: "vitrinaya-workbook", sheetId: "sheet", expectedVersion: 1, headerRow: 1, firstRow: 2, lastRow: 2, confirmed: true, mapping: { "0": "sku", "1": "name", "2": "quantity" } };
    const preview = await fetch(`${base}/api/inventory/workbook/preview`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); assert.equal(preview.status, 200); const previewJson = await preview.json() as { result: { rows: { stockCurrent: number; stockTarget: number; delta: number }[] } }; assert.equal(previewJson.result.rows[0]?.stockCurrent, 8); assert.equal(previewJson.result.rows[0]?.stockTarget, 0); assert.equal(previewJson.result.rows[0]?.delta, -8);
    const applyBody = { ...body, batchId: randomUUID(), operationId: randomUUID(), reason: "Conteo HTTP" };
    const applied = await fetch(`${base}/api/inventory/workbook/preview/apply`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(applyBody) }); assert.equal(applied.status, 200); const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }); assert.equal(after.stock, 0); assert.equal(await db.inventoryMovement.count({ where: { itemId: item.id } }), 1);
    const retry = await fetch(`${base}/api/inventory/workbook/preview/apply`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(applyBody) }); assert.ok([200, 409].includes(retry.status)); assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 0);
    const foreign = await fetch(`${base}/api/inventory/workbook/preview`, { method: "POST", headers: { Authorization: `Bearer ${generateToken({ userId: other.id, email: other.email })}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); assert.equal(foreign.status, 404);
    assert.equal((await fetch(`${base}/api/inventory/workbook/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    console.log("PASS workbook HTTP preview/apply, quantity zero, receipt movement, retry and owner isolation");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await db.$disconnect(); }
}
main().catch(error => { console.error(`FAIL workbook HTTP verifier: ${error instanceof Error ? error.message : "ERROR"}`); process.exitCode = 1; });
