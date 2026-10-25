import { ImportReadError, XLSX_LIMITS } from "./contracts";

type Attributes = Record<string, string>;
type Visitor = { open?: (name: string, attributes: Attributes, parent: string | undefined) => void; close?: (name: string) => void };
const invalid = (): never => { throw new ImportReadError("XML_INVALID"); };
const utf8 = new TextDecoder("utf-8", { fatal: true });
function entities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);|&/g, (_entity, code: string | undefined) => {
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (code && Object.hasOwn(known, code)) return known[code];
    if (!code || !/^#(?:[0-9]{1,7}|x[0-9a-fA-F]{1,6})$/.test(code)) return invalid();
    const point = code.startsWith("#x") ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    if (!(point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)))) return invalid();
    return String.fromCodePoint(point);
  });
}

// A bounded structural scanner, not an XML-to-object/matrix parser. No DTD/entities/CDATA.
// Quoted delimiters, matching tags, unique attributes and depth are checked before the reader runs.
export function inspectXml(data: Uint8Array, visitor: Visitor = {}) {
  const text = utf8.decode(data);
  const stack: string[] = [];
  let at = 0, tags = 0, roots = 0;
  while (at < text.length) {
    const start = text.indexOf("<", at);
    const content = text.slice(at, start < 0 ? text.length : start);
    if ((!stack.length && content.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) invalid();
    entities(content);
    if (start < 0) break;
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end < 0 || text.slice(start + 4, end).includes("--")) invalid();
      at = end + 3; continue;
    }
    if (text.startsWith("<?xml ", start)) {
      const end = text.indexOf("?>", start + 6);
      if (start !== 0 || end < 0 || end - start > 200 || /encoding\s*=\s*["'](?!utf-8["'])/i.test(text.slice(start, end))) invalid();
      at = end + 2; continue;
    }
    if (text.startsWith("<!", start) || text.startsWith("<?", start)) invalid();
    let end = start + 1, quote = "";
    for (; end < text.length && end - start <= 4096; end++) {
      const character = text[end];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end === text.length || end - start > 4096 || quote || ++tags > 100_000) invalid();
    const tag = text.slice(start + 1, end);
    const closing = tag.startsWith("/"), empty = tag.endsWith("/");
    const match = /^(\/?)([A-Za-z_][\w.:-]*)/.exec(tag);
    if (!match) return invalid();
    const fullName = match[2], name = fullName.split(":").pop() ?? "";
    let remaining = tag.slice(match[0].length);
    if (closing) {
      if (remaining.trim() || stack.pop() !== fullName) invalid();
      visitor.close?.(name);
    } else {
      if (empty) remaining = remaining.slice(0, -1);
      const attributes: Attributes = Object.create(null);
      let offset = 0, count = 0;
      const attribute = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(["'])([^]*?)\2/y;
      while (offset < remaining.length && remaining.slice(offset).trim()) {
        attribute.lastIndex = offset;
        const found = attribute.exec(remaining);
        if (!found) throw new ImportReadError("XML_INVALID");
        if (Object.hasOwn(attributes, found[1]) || ++count > 64 || found[3].includes("<")) invalid();
        attributes[found[1]] = entities(found[3]);
        offset = attribute.lastIndex;
      }
      if (!stack.length && ++roots > 1) invalid();
      if (stack.length >= 32) invalid();
      visitor.open?.(name, attributes, stack.at(-1)?.split(":").pop());
      if (empty) visitor.close?.(name); else stack.push(fullName);
    }
    at = end + 1;
  }
  if (stack.length || roots !== 1) invalid();
}

function coordinate(value: string) {
  const match = /^([A-L])([1-9][0-9]{0,2})$/.exec(value);
  if (!match || Number(match[2]) > XLSX_LIMITS.rows + 1) throw new ImportReadError("SHEET_INVALID");
  return { column: match[1].charCodeAt(0) - 65, row: Number(match[2]) };
}

export function inspectWorkbook(files: Record<string, Uint8Array>) {
  if (!files["[Content_Types].xml"] || !files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"]) throw new ImportReadError("SHEET_INVALID");
  // All XML is checked before read-excel-file sees even shared strings or styles.
  for (const [name, bytes] of Object.entries(files)) {
    if (/\.(xml|rels)$/.test(name)) inspectXml(bytes, { open: (tag, attributes) => {
      if (attributes.TargetMode === "External" || Object.values(attributes).some(v => /macroEnabled|vbaProject/i.test(v))) throw new ImportReadError("XLSX_REQUIRED");
      if (tag === "Relationship" && attributes.Target && /^[a-z]+:/i.test(attributes.Target)) throw new ImportReadError("XLSX_REQUIRED");
    } });
  }
  let relationId: string | undefined;
  inspectXml(files["xl/workbook.xml"], { open: (name, attributes) => {
    if (name === "sheet" && attributes.name === "Productos") {
      if (relationId) throw new ImportReadError("SHEET_INVALID");
      relationId = attributes["r:id"];
    }
  } });
  let productPath: string | undefined;
  const relationshipIds = new Set<string>();
  inspectXml(files["xl/_rels/workbook.xml.rels"], { open: (name, attributes) => {
    if (name !== "Relationship") return;
    if (!attributes.Id || relationshipIds.has(attributes.Id)) throw new ImportReadError("SHEET_INVALID");
    relationshipIds.add(attributes.Id);
    if (attributes.Id === relationId) {
      if (!attributes.Type?.endsWith("/worksheet") || !attributes.Target || /[%\\?#]/.test(attributes.Target)) throw new ImportReadError("SHEET_INVALID");
      const url = new URL(attributes.Target, "https://xlsx.invalid/xl/");
      if (url.origin !== "https://xlsx.invalid") throw new ImportReadError("SHEET_INVALID");
      productPath = url.pathname.slice(1);
    }
  } });
  if (!relationId || !productPath || !files[productPath]) throw new ImportReadError("SHEET_INVALID");
  let row = 0, cell: { row: number; column: number } | undefined;
  const rows = new Set<number>(), cells = new Set<string>(), formulas = new Set<string>();
  inspectXml(files[productPath], { open: (name, attributes, parent) => {
    if (name === "dimension") {
      const refs = attributes.ref?.split(":");
      if (!refs || refs.length > 2) throw new ImportReadError("SHEET_INVALID");
      refs.forEach(coordinate);
    }
    if (name === "row") {
      row = Number(attributes.r);
      if (parent !== "sheetData" || !Number.isInteger(row) || row < 1 || row > 501 || rows.has(row)) throw new ImportReadError("SHEET_INVALID");
      rows.add(row);
    }
    if (name === "c") {
      if (parent !== "row" || cell || !attributes.r) throw new ImportReadError("SHEET_INVALID");
      cell = coordinate(attributes.r);
      if (cell.row !== row || cells.has(attributes.r) || cells.size >= 501 * 12) throw new ImportReadError("SHEET_INVALID");
      cells.add(attributes.r);
    }
    if (name === "f" && cell) formulas.add(`${cell.row}:${cell.column}`);
  }, close: name => { if (name === "c") cell = undefined; if (name === "row") row = 0; } });
  return { formulas };
}
