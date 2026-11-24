export type InventoryItemView = { id: string; name: string; sku: string; stock: number; minimumStock: number; dataVersion: number; stockVersion: number; commercialTerms: { unitSalePrice: string; referenceUnitCost: string | null; currency: "COP"; version: number } | null };
export function parseInventoryItemReply(value: unknown, id: string): InventoryItemView;
