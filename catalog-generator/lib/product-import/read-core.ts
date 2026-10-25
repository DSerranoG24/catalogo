import { IMPORT_COLUMNS, ImportReadError, ImportReadResult, ImportRow, RowIssue, XLSX_LIMITS } from "./contracts";
import { inspectWorkbook } from "./xml-guard";
import { sanitizedZip, verifyAndUnzip } from "./zip";

type SheetReader = (input: ArrayBuffer, sheet: string) => Promise<unknown[][]>;
const blank = (value: unknown) => value == null || (typeof value === "string" && !value.trim());

export async function readVerifiedWorkbook(bytes: Uint8Array, readSheet: SheetReader): Promise<ImportReadResult> {
  const verified = verifyAndUnzip(bytes);
  const inspected = inspectWorkbook(verified.files);
  const safe = sanitizedZip(verified.files);
  // Only this newly constructed STORE archive crosses into the third-party spreadsheet parser.
  const data = await readSheet(safe.buffer, "Productos");
  if (data.length > XLSX_LIMITS.rows + 1 || !data[0] || data[0].length !== IMPORT_COLUMNS.length ||
      IMPORT_COLUMNS.some(([header], column) => data[0][column] !== header)) throw new ImportReadError("SHEET_INVALID");
  const rows: ImportRow[] = [], errors: RowIssue[] = [];
  let totalRows = 0;
  for (let index = 1; index < data.length; index++) {
    const cells = data[index] ?? [];
    if (cells.every(blank)) continue;
    totalRows++;
    const row: ImportRow = { rowNumber: index + 1, name: "" };
    const issues: RowIssue[] = [];
    for (const [column, [, field]] of IMPORT_COLUMNS.entries()) {
      const value = cells[column];
      if (inspected.formulas.has(`${index + 1}:${column}`)) { issues.push({ rowNumber: index + 1, field, code: "FORMULA_NOT_ALLOWED" }); continue; }
      if (blank(value)) continue;
      if (field === "price" || field === "stock" || field === "salePrice") {
        if (typeof value !== "number" || !Number.isFinite(value)) issues.push({ rowNumber: index + 1, field, code: "NUMBER_REQUIRED" });
        else row[field] = value;
      } else if (field === "saleEnabled") {
        const flag = typeof value === "string" ? value.trim().normalize("NFC").toLowerCase() : "";
        if (flag !== "sí" && flag !== "no") issues.push({ rowNumber: index + 1, field, code: "BOOLEAN_REQUIRED" });
        else row.saleEnabled = flag === "sí";
      } else if (typeof value !== "string") issues.push({ rowNumber: index + 1, field, code: "TEXT_REQUIRED" });
      else row[field] = value.trim().normalize("NFC");
    }
    if (issues.length) errors.push(...issues); else rows.push(row);
  }
  return { totalRows, rows, errors, bytes: { compressed: bytes.length, expanded: verified.expanded, entries: verified.entries } };
}
