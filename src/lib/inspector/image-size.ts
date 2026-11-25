/**
 * The pixel size of a stored photo, read from its header. Pure; no image
 * library (the Next process never loads `@napi-rs/canvas`).
 *
 * JPEG: the first start-of-frame marker. A JPEG's EXIF orientation is not
 * applied here: the phone and the web both re-encode a photo before upload,
 * which bakes the orientation into the pixels, so the stored size is the
 * size as seen.
 */
export type ImageSize = { width: number; height: number };

export function imageSize(buf: Uint8Array): ImageSize | null {
  if (buf.length < 24) return null;
  // PNG: signature, then IHDR width / height (big-endian)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return positive(readU32BE(buf, 16), readU32BE(buf, 20));
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  // WebP: RIFF....WEBP
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return webpSize(buf);
  return null;
}

function jpegSize(buf: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // padding bytes
    if (marker === 0xff) {
      i++;
      continue;
    }
    // markers without a length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2) return null;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (buf[i + 5] << 8) | buf[i + 6];
      const width = (buf[i + 7] << 8) | buf[i + 8];
      return positive(width, height);
    }
    // start of scan: no frame header was found before the image data
    if (marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf: Uint8Array): ImageSize | null {
  const chunk = ascii(buf, 12, 4);
  if (chunk === "VP8X" && buf.length >= 30) {
    return positive(1 + readU24LE(buf, 24), 1 + readU24LE(buf, 27));
  }
  if (chunk === "VP8 " && buf.length >= 30) {
    return positive(((buf[27] << 8) | buf[26]) & 0x3fff, ((buf[29] << 8) | buf[28]) & 0x3fff);
  }
  if (chunk === "VP8L" && buf.length >= 25) {
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    return positive(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
  }
  return null;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}
function readU24LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function ascii(b: Uint8Array, o: number, n: number): string {
  return String.fromCharCode(...b.subarray(o, o + n));
}
function positive(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}
