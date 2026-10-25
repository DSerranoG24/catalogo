import { Inflate, zipSync } from "fflate";
import { ImportReadError, XLSX_LIMITS } from "./contracts";

type Entry = { name: string; offset: number; start: number; dataEnd: number; end: number; method: number; crc: number; size: number };
const fail = (): never => { throw new ImportReadError("ZIP_INVALID"); };
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crcChunk(crc: number, data: Uint8Array) {
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc >>> 0;
}
function extraFields(view: DataView, start: number, end: number) {
  for (let at = start; at < end;) {
    if (at + 4 > end) fail();
    const tag = view.getUint16(at, true), length = view.getUint16(at + 2, true);
    if (tag === 1) throw new ImportReadError("ZIP64_UNSUPPORTED");
    if (tag === 0x9901) throw new ImportReadError("ZIP_ENCRYPTED");
    at += 4 + length;
    if (at > end) fail();
  }
}
function inspectZip(bytes: Uint8Array): Entry[] {
  if (bytes.length > XLSX_LIMITS.compressed) throw new ImportReadError("FILE_TOO_LARGE");
  if (bytes.length < 22) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0) fail();
  const count = view.getUint16(eocd + 10, true), cdSize = view.getUint32(eocd + 12, true), cdStart = view.getUint32(eocd + 16, true);
  if (count === 65535 || cdSize === 0xffffffff || cdStart === 0xffffffff || (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50)) throw new ImportReadError("ZIP64_UNSUPPORTED");
  if (count > XLSX_LIMITS.entries) throw new ImportReadError("ZIP_ENTRIES_LIMIT");
  if (!count || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || view.getUint16(eocd + 8, true) !== count || cdStart + cdSize !== eocd) fail();
  let cursor = cdStart, declared = 0;
  const names = new Set<string>(), entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || view.getUint32(cursor, true) !== 0x02014b50) fail();
    const version = view.getUint16(cursor + 6, true), flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true), offset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (size === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff) throw new ImportReadError("ZIP64_UNSUPPORTED");
    if (flags & 0x2041) throw new ImportReadError("ZIP_ENCRYPTED");
    if (flags & ~0x080e || version > 20 || ![0, 8].includes(method) || next > eocd || view.getUint16(cursor + 34, true)) fail();
    if (size > XLSX_LIMITS.entry) throw new ImportReadError("ZIP_ENTRY_LIMIT");
    declared += size;
    if (declared > XLSX_LIMITS.expanded) throw new ImportReadError("ZIP_TOTAL_LIMIT");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = decoder.decode(nameBytes);
    const mode = (view.getUint32(cursor + 38, true) >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) fail();
    if (!name || name.length > 240 || /[\\\x00-\x1f:]/.test(name) || name.startsWith("/") || name.includes("//") || name.split("/").some(p => [".", "..", "__proto__", "prototype", "constructor"].includes(p)) || names.has(name.toLowerCase())) fail();
    if (/vba|activex|embeddings/i.test(name)) throw new ImportReadError("XLSX_REQUIRED");
    names.add(name.toLowerCase());
    extraFields(view, cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize);
    if (offset + 30 > cdStart || view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 4, true) !== version || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) fail();
    const localNameSize = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localNameSize + localExtra;
    if (localNameSize !== nameSize || start + compressed > cdStart || !nameBytes.every((b, n) => bytes[offset + 30 + n] === b)) fail();
    extraFields(view, offset + 30 + localNameSize, start);
    const localCrc = view.getUint32(offset + 14, true), localCompressed = view.getUint32(offset + 18, true), localSize = view.getUint32(offset + 22, true);
    let end = start + compressed;
    if (flags & 8) {
      if ((localCrc && localCrc !== crc) || (localCompressed && localCompressed !== compressed) || (localSize && localSize !== size)) fail();
      if (end + 12 > cdStart) fail();
      if (view.getUint32(end, true) === 0x08074b50) end += 4;
      if (end + 12 > cdStart || view.getUint32(end, true) !== crc || view.getUint32(end + 4, true) !== compressed || view.getUint32(end + 8, true) !== size) fail();
      end += 12;
    } else if (localCrc !== crc || localCompressed !== compressed || localSize !== size) fail();
    if ((method === 0 && compressed !== size) || (name.endsWith("/") && (size || compressed))) fail();
    entries.push({ name, offset, start, dataEnd: start + compressed, end, method, crc, size });
    cursor = next;
  }
  if (cursor !== eocd) fail();
  let end = 0;
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) { if (entry.offset !== end) fail(); end = entry.end; }
  if (end !== cdStart) fail();
  return entries;
}

export function verifyAndUnzip(bytes: Uint8Array) {
  const entries = inspectZip(bytes);
  const files: Record<string, Uint8Array> = Object.create(null);
  let expanded = 0;
  for (const entry of entries) {
    const chunks: Uint8Array[] = [];
    let size = 0, crc = 0xffffffff;
    const retain = (chunk: Uint8Array) => {
      // Check actual output BEFORE retaining it; declared sizes are not a quota.
      if (size + chunk.length > XLSX_LIMITS.entry) throw new ImportReadError("ZIP_ENTRY_LIMIT");
      if (expanded + chunk.length > XLSX_LIMITS.expanded) throw new ImportReadError("ZIP_TOTAL_LIMIT");
      size += chunk.length; expanded += chunk.length;
      crc = crcChunk(crc, chunk);
      chunks.push(chunk);
    };
    // Small compressed input chunks bound transient Inflate output as well as retained output.
    // Raw Inflate does not allocate an output buffer from an attacker-declared ZIP size.
    const inflater = entry.method === 8 ? new Inflate(retain) : null;
    const dataEnd = entry.dataEnd;
    if (dataEnd === entry.start && inflater) inflater.push(new Uint8Array(), true);
    for (let at = entry.start; at < dataEnd; at += 512) {
      const next = Math.min(at + 512, dataEnd), chunk = bytes.subarray(at, next);
      if (inflater) inflater.push(chunk, next === dataEnd); else retain(chunk);
    }
    if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail();
    const content = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
    files[entry.name] = content;
  }
  return { files, expanded, entries: entries.length };
}

export function sanitizedZip(files: Record<string, Uint8Array>) {
  // STORE avoids a second inflation and any decompression workers inside read-excel-file.
  return zipSync(files, { level: 0 });
}
