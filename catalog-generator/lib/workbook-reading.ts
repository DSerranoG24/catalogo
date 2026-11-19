export const readingFields = ["ignore", "name", "sku", "quantity", "unitSalePrice", "referenceUnitCost", "minimumStock"] as const;
export type ReadingField = typeof readingFields[number];
type Scalar = string | number | boolean | null;
export type ReadingCell = { value: Scalar; formula: boolean; error: boolean };
export type ReadingSheet = { id: string; name: string; rowCount: number; columnCount: number; cells: Record<string, Record<string, ReadingCell>>; merges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] };
export type ReadingBook = { name: string; sheets: ReadingSheet[] };
export type ReadingRow = { rowNumber: number; values: Partial<Record<Exclude<ReadingField, "ignore">, string>>; errors: string[]; formulas: string[] };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const blank = (value: Scalar) => value === null || (typeof value === "string" && !value.trim());
const formulaErrors = new Set(["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!"]);
export function columnName(index: number) { let name = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }

export function readWorkbookSnapshot(text: string): ReadingBook {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error("La hoja supera el tamaño permitido para analizarla.");
  const source: unknown = JSON.parse(text);
  if (!record(source) || !Array.isArray(source.sheetOrder) || !record(source.sheets) || source.sheetOrder.length > 10) throw new Error("El documento no contiene pestañas válidas.");
  const sheets: ReadingSheet[] = [];
  for (const id of source.sheetOrder) {
    if (typeof id !== "string") throw new Error("Identificador de pestaña inválido.");
    const raw = source.sheets[id];
    if (!record(raw) || typeof raw.name !== "string" || typeof raw.rowCount !== "number" || typeof raw.columnCount !== "number" || !Number.isInteger(raw.rowCount) || !Number.isInteger(raw.columnCount) || raw.rowCount < 1 || raw.rowCount > 10000 || raw.columnCount < 1 || raw.columnCount > 200) throw new Error("La pestaña tiene dimensiones no admitidas.");
    const cells: ReadingSheet["cells"] = {};
    if (record(raw.cellData)) for (const [r, columns] of Object.entries(raw.cellData)) {
      if (!/^\d+$/.test(r) || Number(r) >= raw.rowCount || !record(columns)) continue;
      const output: Record<string, ReadingCell> = {};
      for (const [c, cell] of Object.entries(columns)) {
        if (!/^\d+$/.test(c) || Number(c) >= raw.columnCount || !record(cell)) continue;
        let value: Scalar = null;
        if (typeof cell.v === "string" || typeof cell.v === "number" || typeof cell.v === "boolean") value = cell.v;
        else if (record(cell.p) && record(cell.p.body) && typeof cell.p.body.dataStream === "string") value = cell.p.body.dataStream.replace(/\r?\n$/, "");
        const formula = typeof cell.f === "string" && cell.f.length > 0;
        output[c] = { value, formula, error: formula && (value === null || (typeof value === "string" && formulaErrors.has(value))) };
      }
      cells[r] = output;
    }
    const merges: ReadingSheet["merges"] = [];
    if (Array.isArray(raw.mergeData) && raw.mergeData.length > 1000) throw new Error("Hay demasiadas combinaciones de celdas para esta primera lectura. Usa una pestaña con una tabla sencilla.");
    if (Array.isArray(raw.mergeData)) for (const range of raw.mergeData) {
      if (!record(range)) continue;
      const { startRow, endRow, startColumn, endColumn } = range;
      if (![startRow, endRow, startColumn, endColumn].every(value => typeof value === "number" && Number.isInteger(value))) continue;
      if (typeof startRow === "number" && typeof endRow === "number" && typeof startColumn === "number" && typeof endColumn === "number") merges.push({ startRow, endRow, startColumn, endColumn });
    }
    sheets.push({ id, name: raw.name, rowCount: raw.rowCount, columnCount: raw.columnCount, cells, merges });
  }
  return { name: typeof source.name === "string" ? source.name : "Hoja", sheets };
}
const aliases: Partial<Record<ReadingField, string[]>> = {
  name: ["nombre", "producto", "articulo", "descripcion", "nombre del producto"],
  sku: ["sku", "codigo", "codigo interno", "referencia"],
  unitSalePrice: ["precio de venta", "precio venta", "precioventacop", "precio de venta cop"],
  referenceUnitCost: ["costo", "costo de referencia", "costo adquisicion", "costorefcop"],
  minimumStock: ["existencia minima", "existenciaminima", "stock minimo", "minimo"],
};
export function suggestReadingFields(sheet: ReadingSheet, headerRow: number): ReadingField[] {
  return Array.from({ length: sheet.columnCount }, (_, column) => {
    const value = sheet.cells[headerRow - 1]?.[column]?.value;
    const label = typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[()]/g, " ").replace(/\s+/g, " ").trim() : "";
    return readingFields.find(field => aliases[field]?.includes(label)) ?? "ignore";
  });
}
export function previewWorkbookReading(sheet: ReadingSheet, headerRow: number, firstRow: number, lastRow: number, mapping: ReadingField[]) {
  if (![headerRow, firstRow, lastRow].every(Number.isInteger) || headerRow < 1 || firstRow <= headerRow || lastRow < firstRow || lastRow > sheet.rowCount || lastRow - firstRow + 1 > 500) throw new Error("Elige la fila de títulos y un rango posterior de hasta 500 filas.");
  const selected = mapping.filter(field => field !== "ignore");
  if (!selected.length) throw new Error("Asigna el significado de al menos una columna.");
  if (new Set(selected).size !== selected.length) throw new Error("Dos columnas tienen el mismo significado. Corrige la asignación antes de leer.");
  const rows: ReadingRow[] = []; let emptyRows = 0;
  for (let number = firstRow; number <= lastRow; number++) {
    const cells = sheet.cells[number - 1] ?? {};
    if (Object.values(cells).every(cell => blank(cell.value) && !cell.formula)) { emptyRows++; continue; }
    const row: ReadingRow = { rowNumber: number, values: {}, errors: [], formulas: [] };
    mapping.forEach((field, column) => {
      if (field === "ignore") return;
      const cell = cells[column], address = `${columnName(column)}${number}`;
      if (sheet.merges.some(range => number - 1 >= range.startRow && number - 1 <= range.endRow && column >= range.startColumn && column <= range.endColumn)) row.errors.push(`${address}: separa las celdas combinadas para leer cada producto sin ambigüedad.`);
      if (cell?.error) { row.errors.push(`${address}: la fórmula no tiene un resultado válido.`); return; }
      if (cell?.formula) row.formulas.push(address);
      const value = cell?.value ?? null;
      if (blank(value)) { if (field === "name" || field === "sku") row.errors.push(`${address}: falta el ${field === "name" ? "nombre" : "SKU"}.`); return; }
      if (field === "name" || field === "sku") {
        if (typeof value !== "string") { row.errors.push(`${address}: usa texto${field === "sku" ? " para conservar los ceros del SKU" : " para el nombre"}.`); return; }
        const normalized = field === "sku" ? value.trim().toUpperCase() : value.trim();
        if (normalized.length > (field === "sku" ? 80 : 160)) row.errors.push(`${address}: el texto es demasiado largo.`);
        row.values[field] = normalized; return;
      }
      const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
      if (!/^\d{1,19}$/.test(text)) { row.errors.push(`${address}: indica un entero no negativo sin separadores; no se interpretarán importes ambiguos.`); return; }
      const max = field === "quantity" || field === "minimumStock" ? BigInt("2147483647") : BigInt("9223372036854775807");
      if (BigInt(text) > max) { row.errors.push(`${address}: el valor supera el límite permitido.`); return; }
      row.values[field] = BigInt(text).toString();
    }); rows.push(row);
  }
  const skus = new Map<string, ReadingRow[]>();
  for (const row of rows) if (row.values.sku) skus.set(row.values.sku, [...(skus.get(row.values.sku) ?? []), row]);
  for (const [sku, group] of skus) if (group.length > 1) for (const row of group) row.errors.push(`SKU ${sku} repetido en las filas ${group.map(value => value.rowNumber).join(", ")}.`);
  return { rows, emptyRows, errorRows: rows.filter(row => row.errors.length).length };
}
