export function detectImageMimeType(buffer: Uint8Array): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/** Reads encoded dimensions without decoding pixels or trusting the filename/MIME. */
export function imageDimensions(input: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(input);
  const mime = detectImageMimeType(b);
  if (mime === "image/png") {
    if (b.length < 33 || b.readUInt32BE(8) !== 13 || b.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
    return width && height ? { width, height } : null;
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset < b.length) {
      if (b[offset++] !== 0xff) return null;
      while (offset < b.length && b[offset] === 0xff) offset++;
      const marker = b[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > b.length) return null;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return null;
        const height = b.readUInt16BE(offset + 3), width = b.readUInt16BE(offset + 5);
        return width && height ? { width, height } : null;
      }
      offset += length;
    }
  }
  if (mime === "image/webp") {
    if (b.length < 20 || b.readUInt32LE(4) + 8 !== b.length) return null;
    let width = 0, height = 0;
    const dimensions = (w: number, h: number) => { width = Math.max(width, w); height = Math.max(height, h); };
    function chunks(start: number, end: number, nested = false): boolean {
      let offset = start;
      while (offset + 8 <= end) {
        const type = b.toString("ascii", offset, offset + 4), size = b.readUInt32LE(offset + 4), data = offset + 8;
        if (data + size > end) return false;
        if (type === "VP8X") {
          if (size < 10 || nested) return false;
          dimensions(b.readUIntLE(data + 4, 3) + 1, b.readUIntLE(data + 7, 3) + 1);
        } else if (type === "VP8L") {
          if (size < 5 || b[data] !== 0x2f) return false;
          const bits = b.readUInt32LE(data + 1);
          dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        } else if (type === "VP8 ") {
          if (size < 10 || b.toString("hex", data + 3, data + 6) !== "9d012a") return false;
          dimensions(b.readUInt16LE(data + 6) & 0x3fff, b.readUInt16LE(data + 8) & 0x3fff);
        } else if (type === "ANMF") {
          if (size < 16 || nested) return false;
          dimensions(b.readUIntLE(data + 6, 3) + 1, b.readUIntLE(data + 9, 3) + 1);
          if (!chunks(data + 16, data + size, true)) return false;
        }
        offset = data + size + (size % 2);
      }
      return offset === end;
    }
    return chunks(12, b.length) && width && height ? { width, height } : null;
  }
  return null;
}
