// The type and pixel size of a PNG, JPEG or WebP file from its first bytes, without decoding it
// (smart-object originals are checked against the size caps in the worker, before any copy).

export type ImageInfo = { mime: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number };

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));

export function imageInfo(b: Uint8Array): ImageInfo | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // PNG: signature, then the IHDR chunk's width and height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG") && ascii(b, 12, "IHDR")) {
    return ok("image/png", v.getUint32(16), v.getUint32(20));
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = v.getUint16(i + 2);
      // SOF0..SOF15, except DHT (c4), JPG (c8) and DAC (cc).
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok("image/jpeg", v.getUint16(i + 7), v.getUint16(i + 5));
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF container with a VP8 (lossy), VP8L (lossless) or VP8X (extended) first chunk.
  if (b.length >= 16 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    if (b.length >= 30 && ascii(b, 12, "VP8 ")) return ok("image/webp", v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff);
    if (b.length >= 25 && ascii(b, 12, "VP8L") && b[20] === 0x2f) {
      const bits = v.getUint32(21, true);
      return ok("image/webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (b.length >= 30 && ascii(b, 12, "VP8X")) {
      return ok("image/webp", 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    }
  }
  return null;
}

const ok = (mime: ImageInfo["mime"], width: number, height: number): ImageInfo | null =>
  width > 0 && height > 0 ? { mime, width, height } : null;
