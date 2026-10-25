export const XLSX_LIMITS = Object.freeze({
  compressed: 5 * 1024 * 1024,
  expanded: 20 * 1024 * 1024,
  entry: 8 * 1024 * 1024,
  entries: 64,
  rows: 500,
  columns: 12,
  timeout: 10_000,
});

export const IMPORT_COLUMNS = [
  ["Nombre", "name"], ["SKU", "sku"], ["Categoría", "categoryName"],
  ["Marca", "brand"], ["Modelo", "model"], ["Descripción", "description"],
  ["Precio", "price"], ["Inventario", "stock"], ["Programar descuento", "saleEnabled"],
  ["Precio de oferta", "salePrice"], ["Inicio de oferta", "saleStartsAt"], ["Fin de oferta", "saleEndsAt"],
] as const;

export type ImportField = typeof IMPORT_COLUMNS[number][1];
export type ImportRow = { rowNumber: number; name: string } & Partial<Record<
  "sku" | "categoryName" | "brand" | "model" | "description" | "saleStartsAt" | "saleEndsAt", string
>> & { price?: number; stock?: number; salePrice?: number; saleEnabled?: boolean };
export type RowIssue = { rowNumber: number; field: ImportField; code: "TEXT_REQUIRED" | "NUMBER_REQUIRED" | "BOOLEAN_REQUIRED" | "FORMULA_NOT_ALLOWED" };
export type ImportReadResult = {
  totalRows: number;
  rows: ImportRow[];
  errors: RowIssue[];
  bytes: { compressed: number; expanded: number; entries: number };
};

const messages = {
  XLSX_REQUIRED: "Selecciona un archivo .xlsx sin macros ni contraseña.",
  FILE_TOO_LARGE: "El archivo supera los 5 MiB permitidos.",
  ZIP_INVALID: "El archivo no tiene una estructura XLSX válida o compatible.",
  ZIP_ENCRYPTED: "No se admiten archivos cifrados o protegidos con contraseña.",
  ZIP64_UNSUPPORTED: "No se admiten archivos ZIP64.",
  ZIP_ENTRIES_LIMIT: "El archivo contiene demasiadas entradas internas (máximo 64).",
  ZIP_ENTRY_LIMIT: "Una entrada descomprimida supera los 8 MiB permitidos.",
  ZIP_TOTAL_LIMIT: "El contenido descomprimido supera los 20 MiB permitidos.",
  XML_INVALID: "El contenido XML no es válido o contiene características no admitidas.",
  SHEET_INVALID: "Se requiere la hoja Productos, con las 12 cabeceras de la plantilla y hasta 500 filas.",
  TIMEOUT: "La lectura superó los 10 segundos. Simplifica el archivo y vuelve a intentarlo.",
  CANCELLED: "Lectura cancelada.",
  READ_FAILED: "No se pudo leer el archivo. Revisa que uses la plantilla .xlsx.",
} as const;
export type ImportReadErrorCode = keyof typeof messages;
export class ImportReadError extends Error {
  constructor(public readonly code: ImportReadErrorCode) { super(messages[code]); this.name = "ImportReadError"; }
}
export function safeReadError(error: unknown): ImportReadErrorCode {
  return error instanceof ImportReadError ? error.code : "READ_FAILED";
}
export function isReadErrorCode(value: unknown): value is ImportReadErrorCode {
  return typeof value === "string" && Object.hasOwn(messages, value);
}
export function requireImportFile(file: Pick<File, "name" | "size">) {
  if (!/\.xlsx$/i.test(file.name)) throw new ImportReadError("XLSX_REQUIRED");
  if (file.size > XLSX_LIMITS.compressed) throw new ImportReadError("FILE_TOO_LARGE");
  if (file.size < 22) throw new ImportReadError("ZIP_INVALID");
}
