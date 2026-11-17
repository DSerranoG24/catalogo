import type { InventoryMovementInput } from "../schemas/inventory.schema";

export function inventoryBalance(stock: number, input: InventoryMovementInput) {
  const next = input.type === "ADJUSTMENT" ? input.quantity
    : stock + (input.type === "IN" ? input.quantity : -input.quantity);
  if (!Number.isSafeInteger(next) || next < 0 || next > 2147483647) throw new Error("INVALID_STOCK");
  return next;
}
