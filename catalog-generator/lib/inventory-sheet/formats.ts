import { inspectWorkbook, inspectXml } from "../product-import/xml-guard";
import { sanitizedZip, verifyAndUnzip } from "../product-import/zip";

export const columns = [
  ["Formato", "profile"], ["ID", "id"], ["SKU", "sku"], ["Nombre", "name"],
  ["PrecioVentaCOP", "unitSalePrice"], ["CostoRefCOP", "referenceUnitCost"], ["AccionCosto", "costAction"],
  ["ExistenciaMinima", "minimumStock"], ["ExistenciaActual", "currentStock"], ["ExistenciaObjetivo", "targetStock"],
  ["MotivoAjuste", "reason"], ["VersionProducto", "dataVersion"], ["VersionExistencia", "stockVersion"], ["VersionFicha", "termsVersion"],
] as const;
export type Field = typeof columns[number][1];
export type Cell = string | number | boolean | null;
export type Values = Partial<Record<Field, Cell>>;
export type Matrix = Cell[][];
export function parseDelimited(text: string, delimiter: string): Matrix {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error("El texto supera 2 MiB.");
  const rows: Matrix = []; let row: Cell[] = [], cell = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char; }
    else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === delimiter || char === "\n" || char === "\r") {
      row.push(cell); cell = ""; closed = false;
      if (row.length > 14) throw new Error("Máximo 14 columnas.");
      if (char !== delimiter) { if (char === "\r" && text[i + 1] === "\n") i++; rows.push(row); row = []; }
    } else { if (closed || char === '"') throw new Error("Comillas CSV inválidas."); cell += char; }
    if (rows.length > 501 || cell.length > 10000) throw new Error("Máximo 500 filas y celdas de tamaño limitado.");
  }
  if (quoted) throw new Error("Hay comillas sin cerrar.");
  if (cell || row.length || closed) { row.push(cell); rows.push(row); }
  if (rows.length > 501 || rows.some(value => value.length > 14)) throw new Error("Máximo 500 filas y 14 columnas.");
  return rows;
}
export function mapRows(matrix: Matrix, mapping: string[]): Values[] {
  if (matrix.length < 2 || matrix.length > 501) throw new Error("El archivo debe incluir cabecera y entre 1 y 500 filas.");
  const mapped = mapping.filter(Boolean);
  if (new Set(mapped).size !== mapped.length || mapped.some(field => !columns.some(([, key]) => key === field))) throw new Error("Asigna cada columna una sola vez.");
  if (!mapped.includes("id") && !mapped.includes("sku")) throw new Error("Asigna ID o SKU para identificar los productos.");
  const profileColumn = mapping.indexOf("profile");
  if (profileColumn >= 0) {
    const profiles = new Set(matrix.slice(1).filter(cells => cells.some(value => value !== null && String(value).trim())).map(cells => cells[profileColumn] ?? ""));
    if (profiles.size > 1 || [...profiles].some(value => value !== "INV1" && value !== "INV1_ESC")) throw new Error("No mezcles perfiles de formato; usa INV1 o INV1_ESC de manera uniforme.");
  }
  return matrix.slice(1).map(cells => {
    const values: Values = {};
    columns.forEach(([, field]) => { const index = mapping.indexOf(field); if (index >= 0) values[field] = cells[index] ?? ""; });
    const marked = values.profile === "INV1_ESC";
    for (const field of ["id", "sku", "name", "reason"] as const) if (marked && typeof values[field] === "string" && values[field].startsWith("'")) values[field] = values[field].slice(1);
    delete values.profile; delete values.currentStock;
    return values;
  });
}
export function suggestedMapping(matrix: Matrix) {
  return (matrix[0] ?? []).map(header => columns.find(([name]) => name === header)?.[1] ?? "");
}
export async function readInventoryWorkbook(bytes: Uint8Array, reader: (input: ArrayBuffer, sheet: string) => Promise<unknown[][]>): Promise<{ matrix: Matrix; hidden: boolean }> {
  const verified = verifyAndUnzip(bytes);
  const workbook = verified.files["xl/workbook.xml"];
  if (!workbook) throw new Error("Se requiere la hoja Inventario, con hasta 500 filas y 14 columnas.");
  inspectXml(workbook, { open: (tag, attributes) => { if (tag === "sheet" && !["Inventario", "Instrucciones"].includes(attributes.name)) throw new Error("Solo se admiten las hojas Inventario e Instrucciones."); } });
  let inspected;
  try { inspected = inspectWorkbook(verified.files, { sheet: "Inventario", columns: 14, rows: 500 }); }
  catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "SHEET_INVALID") throw new Error("Se requiere la hoja Inventario, con hasta 500 filas y 14 columnas."); throw cause; }
  if (inspected.formulas.size) throw new Error("El archivo contiene fórmulas. Pega únicamente valores y vuelve a importar.");
  const safe = sanitizedZip(verified.files), input = await reader(safe.buffer, "Inventario");
  if (input.length > 501 || input.some(row => row.length > 14)) throw new Error("Máximo 500 filas y 14 columnas.");
  const matrix = input.map(row => row.map(value => {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return true;
  }));
  // Numeric SKU cells remain numeric, so server validation requires explicit correction.
  const mapping = suggestedMapping(matrix);
  for (const row of matrix.slice(1)) for (const field of ["unitSalePrice", "referenceUnitCost"] as const) {
    const index = mapping.indexOf(field); if (index >= 0 && typeof row[index] === "number" && Number.isSafeInteger(row[index])) row[index] = String(row[index]);
  }
  return { matrix, hidden: inspected.hidden };
}
