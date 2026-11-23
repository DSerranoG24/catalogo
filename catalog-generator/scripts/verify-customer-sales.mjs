import assert from "node:assert/strict";
import { parseCustomerSales, parseCustomerSaleDetail, parseCustomerSearch, formatHistoricalMoney, saleStatuses } from "../lib/customer-sales.mjs";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = { id: id(1), fullName: "Nombre actual", archivedAt: null };
const sale = { id: id(2), status: "CANCELLED", version: 2, currency: "COP", total: "9007199254740993", createdAt: "2026-11-23T12:00:00Z", sourceOrderId: null, customerNameSnapshot: "Original", customerName: null };
const page = { success: true, customer, sales: [sale], nextCursor: null };
const detail = { ...sale, customerId: customer.id, customerPhoneSnapshot: null, customerEmailSnapshot: null, customerPhone: null,
  lines: [{ id: id(3), itemName: "Nombre histórico", sku: "SKU-OLD", quantity: 3, unitPrice: "100", unitDiscount: "1", lineTotal: "297" }] };
assert.equal(parseCustomerSales(page, customer.id, "all", null).sales[0].total, sale.total);
assert.equal(parseCustomerSaleDetail({ result: detail }, sale.id, customer.id).lines[0].lineTotal, "297");
assert.equal(formatHistoricalMoney(sale.total, "COP").replace(/\D/g, ""), sale.total);
for (const status of saleStatuses) assert.equal(parseCustomerSales({ ...page, sales: [{ ...sale, status }] }, customer.id, status, null).sales[0].status, status);
assert.deepEqual(parseCustomerSales({ ...page, sales: [] }, customer.id, "all", id(9)).sales, []);
assert.equal(parseCustomerSales({ ...page, customer: { ...customer, archivedAt: sale.createdAt }, sales: [{ ...sale, customerNameSnapshot: null }] }, customer.id, "all", null).sales[0].customerNameSnapshot, null);
for (const bad of [null, {}, { ...page, customer: { ...customer, id: id(99) } }, { ...page, sales: [sale, sale] }, { ...page, nextCursor: sale.id },
  ...[{ total: 12 }, { total: "1e20" }, { total: "-1" }, { createdAt: "bad" }, { status: "PAID" }, { sourceOrderId: "bad" }].map(patch => ({ ...page, sales: [{ ...sale, ...patch }] }))]) assert.throws(() => parseCustomerSales(bad, customer.id, "all", null));
assert.throws(() => parseCustomerSales(page, customer.id, "DRAFT", null));
assert.throws(() => parseCustomerSales(page, customer.id, "all", sale.id));
for (const bad of [null, { result: { ...detail, customerId: id(99) } }, { result: { ...detail, id: id(99) } }, { result: { ...detail, lines: [{ ...detail.lines[0], unitPrice: 100 }] } }]) assert.throws(() => parseCustomerSaleDetail(bad, sale.id, customer.id));
assert.equal(parseCustomerSearch({ success: true, page: 1, pageSize: 25, hasMore: false, customers: [customer] }, 1).customers[0].id, customer.id);
assert.throws(() => parseCustomerSearch({ success: true, page: 2, pageSize: 25, hasMore: false, customers: [customer] }, 1));
console.log("Customer sales: historical values, bigint, statuses, empty pages and malformed/mixed responses passed.");
