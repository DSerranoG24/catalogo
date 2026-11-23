import assert from "node:assert/strict";
import { saleBuyer } from "../lib/sale-buyer.mjs";
const sale = { customerNameSnapshot: "Nombre original", customerPhoneSnapshot: "3000000000", customerEmailSnapshot: "original@example.invalid", customer: { fullName: "Nombre editado", phone: "3110000000", email: "changed@example.invalid" } };
assert.deepEqual(saleBuyer(sale), { name: "Nombre original", phone: "3000000000", email: "original@example.invalid" });
sale.customer.fullName = "Editado otra vez";
assert.equal(saleBuyer(sale).name, "Nombre original");
assert.deepEqual(saleBuyer({ customerId: null, customerName: "Histórico", customerPhone: "300" }), { name: "Histórico", phone: "300", email: null });
assert.deepEqual(saleBuyer({}), { name: null, phone: null, email: null });
assert.equal(saleBuyer({ customer: sale.customer }).name, null);
assert.deepEqual(saleBuyer({ customerId: null, customerNameSnapshot: "Comprador pedido", customerPhoneSnapshot: "3000000000", customerEmailSnapshot: "order@example.invalid", customer: null }), {
  name: "Comprador pedido", phone: "3000000000", email: "order@example.invalid",
});
console.log("PASS sale buyer uses historical snapshots, preserves legacy names and never substitutes the current customer");
