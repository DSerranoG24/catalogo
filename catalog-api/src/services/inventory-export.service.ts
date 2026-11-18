import { prisma } from "../config/prisma";
import { inventoryItemView, lockInventoryOwner } from "../repositories/inventory.repository";

export const INVENTORY_HEADERS = ["Formato", "ID", "SKU", "Nombre", "PrecioVentaCOP", "CostoRefCOP", "AccionCosto", "ExistenciaMinima", "ExistenciaActual", "ExistenciaObjetivo", "MotivoAjuste", "VersionProducto", "VersionExistencia", "VersionFicha"];
const textColumns = new Set([1, 2, 3, 10]);
const safeText = (value: string) => /^[\s\u0000-\u001f]*[=+\-@']/.test(value) || /^\d+$/.test(value) ? `'${value}` : value;
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function inventoryCsv(rows: string[][]) {
  return "\ufeff" + [INVENTORY_HEADERS, ...rows.map(row => row.map((value, index) => index === 0 ? "INV1_ESC" : textColumns.has(index) ? safeText(value) : value))].map(row => row.map(quote).join(",")).join("\r\n");
}
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
// Bounded STORE ZIP writer: no compression dependency or executable spreadsheet content.
function zip(files: Record<string, string>) {
  const local: Buffer[] = [], directory: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(content), checksum = crc(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    local.push(header, filename, data); directory.push(central, filename); offset += header.length + filename.length + data.length;
  }
  const entries = Object.keys(files).length, size = directory.reduce((sum, entry) => sum + entry.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries, 8); end.writeUInt16LE(entries, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...directory, end]);
}
export function inventoryXlsx(rows: string[][]) {
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheet = [INVENTORY_HEADERS, ...rows].map((row, index) => `<row r="${index + 1}">${row.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("");
  return zip({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Inventario" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${main}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>${sheet}</sheetData></worksheet>`,
  });
}
export async function exportInventory(userId: string, q: string, limit: number, cursor: string | undefined, segment: boolean, format: "csv" | "xlsx", template: boolean) {
  const capture = await prisma.$transaction(async tx => {
    await lockInventoryOwner(tx, userId);
    if (cursor && !await tx.inventoryItem.findFirst({ where: { id: cursor, userId } })) throw new Error("NOT_FOUND");
    const term = q.replace(/[\\%_]/g, "\\$&");
    const items = template ? [] : await tx.inventoryItem.findMany({ where: { userId, OR: [{ name: { contains: term, mode: "insensitive" } }, { sku: { contains: term, mode: "insensitive" } }] }, include: { commercialTerms: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (items.length > limit && !segment) throw new Error("EXPORT_LIMIT");
    return { items: items.slice(0, limit).map(inventoryItemView), nextCursor: items.length > limit ? items[limit - 1]?.id : undefined, capturedAt: new Date().toISOString() };
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  const rows = capture.items.map(item => ["INV1", item.id, item.sku, item.name, item.commercialTerms?.unitSalePrice ?? "", item.commercialTerms?.referenceUnitCost ?? "", "", String(item.minimumStock), String(item.stock), "", "", String(item.dataVersion), String(item.stockVersion), item.commercialTerms ? String(item.commercialTerms.version) : ""]);
  // Validate the expanded size too; never hand a non-importable ZIP bomb to the user.
  if (Buffer.byteLength(canonicalExport(rows)) > 8 * 1024 * 1024) throw new Error("EXPORT_LIMIT");
  const bytes = format === "csv" ? Buffer.from(inventoryCsv(rows)) : inventoryXlsx(rows);
  if (bytes.length > 20 * 1024 * 1024) throw new Error("EXPORT_LIMIT");
  return { bytes, nextCursor: capture.nextCursor, capturedAt: capture.capturedAt, count: rows.length };
}
const canonicalExport = (rows: string[][]) => JSON.stringify(rows);
export function inventoryReportCsv(rows: { rowNumber: number; values: { sku?: string }; action: string; delta: number; errors: { code: string; message: string }[] }[]) {
  return "\ufeff" + [["Formato", "Fila", "SKU", "Estado", "Delta", "Errores"], ...rows.map(row => ["INV1_REPORT", String(row.rowNumber), row.values.sku ?? "", row.action, String(row.delta), row.errors.map(error => `${error.code}: ${error.message}`).join("; ")])].map(row => row.map(value => quote(safeText(value))).join(",")).join("\r\n");
}
