import { z } from "zod";

export function validateWorkbookSnapshot(text: string): boolean {
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) return false;
  let root: unknown;
  try { root = JSON.parse(text); } catch { return false; }
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!record(root) || typeof root.id !== "string" || root.id.length > 160 || typeof root.name !== "string" || root.name.length > 160 || !Array.isArray(root.sheetOrder) || !record(root.sheets)) return false;
  if (!root.sheetOrder.length || root.sheetOrder.length > 10 || Object.keys(root.sheets).length !== root.sheetOrder.length || new Set(root.sheetOrder).size !== root.sheetOrder.length) return false;
  let cells = 0;
  for (const key of root.sheetOrder) {
    if (typeof key !== "string" || key.length > 160) return false;
    const sheet = root.sheets[key];
    if (!record(sheet) || sheet.id !== key || typeof sheet.name !== "string" || sheet.name.length > 160 || !Number.isInteger(sheet.rowCount) || !Number.isInteger(sheet.columnCount)) return false;
    if (typeof sheet.rowCount !== "number" || sheet.rowCount < 1 || sheet.rowCount > 10000 || typeof sheet.columnCount !== "number" || sheet.columnCount < 1 || sheet.columnCount > 200) return false;
    if (sheet.cellData !== undefined) {
      if (!record(sheet.cellData)) return false;
      for (const [row, columns] of Object.entries(sheet.cellData)) {
        if (!/^\d+$/.test(row) || Number(row) >= sheet.rowCount || !record(columns)) return false;
        for (const column of Object.keys(columns)) if (!/^\d+$/.test(column) || Number(column) >= sheet.columnCount || ++cells > 50000) return false;
      }
    }
  }
  // Bound opaque SDK metadata without recursively traversing hostile JSON on the stack.
  const pending: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const next = pending.pop(); if (!next || ++nodes > 200000 || next.depth > 32) return false;
    if (next.value && typeof next.value === "object") for (const [key, value] of Object.entries(next.value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) return false;
      pending.push({ value, depth: next.depth + 1 });
    }
  }
  return true;
}
export const workbookSaveSchema = z.object({
  expectedVersion: z.number().int().positive().nullable(), operationId: z.uuid(),
  snapshot: z.string().max(2 * 1024 * 1024).refine(validateWorkbookSnapshot, "Hoja inválida o demasiado grande: máximo 10 pestañas, 10.000 filas, 200 columnas, 50.000 celdas con contenido y 2 MiB."),
}).strict();
