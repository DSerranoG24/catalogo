import { detectImageMimeType } from "../utils/image-validation";
import { inflateSync } from "node:zlib";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function validPng(bytes: Buffer, width: number, height: number): boolean {
  if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  const depth = bytes[24];
  const color = bytes[25];
  if (depth === undefined || color === undefined || bytes[26] !== 0 || bytes[27] !== 0) return false;
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(color);
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)
    || (color === 3 && depth === 16) || ([2, 4, 6].includes(color) && depth < 8)) return false;
  const interlace = bytes[28];
  if (interlace !== 0 && interlace !== 1) return false;
  const passes = interlace === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const rows: { stride: number; height: number }[] = [];
  let expected = 0;
  for (const [x = 0, y = 0, dx = 1, dy = 1] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    const h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    const stride = Math.ceil(w * channels * depth / 8) + 1;
    expected += stride * h;
    rows.push({ stride, height: h });
  }
  if (expected > 64 * 1024 * 1024) return false;
  const chunks: Buffer[] = [];
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + 12 + length > bytes.length) return false;
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (kind === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (kind === "IEND") { ended = true; break; }
    offset += length + 12;
  }
  if (!ended || !chunks.length) return false;
  // Validate compressed rows before PDFKit's asynchronous alpha/interlace decoder sees them.
  // A corrupt image must not trigger an uncaught decoder exception in the API process.
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
  if (raw.length !== expected) return false;
  let offset = 0;
  for (const row of rows) for (let y = 0; y < row.height; y++) {
    const filter = raw[offset];
    if (filter === undefined || filter > 4) return false;
    offset += row.stride;
  }
  return true;
}

function reasonableDimensions(bytes: Buffer): boolean {
  if (detectImageMimeType(bytes) === "image/png") {
    if (bytes.length < 24) return false;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 && width * height <= 16_000_000 && validPng(bytes, width, height);
  }
  // Read JPEG SOF dimensions before PDFKit decodes a potentially compressed large image.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === undefined) return false;
    if (marker === 0xd9 || marker === 0xda) return false;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 && width * height <= 16_000_000;
    }
    offset += length + 2;
  }
  return false;
}

export async function loadCurrentQuotationLogo(catalogId: string, path: string | null, fetcher = fetch): Promise<Buffer | undefined> {
  if (!path || /\.webp$/i.test(path)) return undefined;
  if (!path.startsWith(`${catalogId}/branding/`) || path.split("/").some(p => !p || p === "." || p === "..")) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const base = new URL(process.env.SUPABASE_URL ?? "");
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!key || base.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(base.hostname)
      || base.port || base.username || base.password || base.search || base.hash) return undefined;
    const url = new URL(`/storage/v1/object/authenticated/product-images/${path.split("/").map(encodeURIComponent).join("/")}`, base);
    const response = await fetcher(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal, redirect: "error", cache: "no-store",
    });
    if (!response.ok || !response.body) return undefined;
    if (Number(response.headers.get("content-length")) > MAX_LOGO_BYTES) { await response.body.cancel(); return undefined; }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_LOGO_BYTES) return undefined;
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    if (!["image/png", "image/jpeg"].includes(detectImageMimeType(bytes) ?? "") || !reasonableDimensions(bytes)) return undefined;
    return bytes;
  } catch {
    // Branding is optional. Never log a storage error containing credentials or signed URLs.
    return undefined;
  } finally { clearTimeout(timer); }
}
