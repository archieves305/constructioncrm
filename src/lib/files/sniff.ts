/**
 * Whether a file's first bytes agree with the type it was uploaded as. Pure.
 *
 * The browser's type comes from the file name, so a renamed executable
 * arrives as "application/pdf". Binary types have a signature; a text type
 * (txt, csv) has none and passes as long as it holds no NUL byte. A type this
 * table does not know passes — the allow-list in limits.ts decides those.
 */
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, s: string, at = 0) => startsWith(b, [...s].map((c) => c.charCodeAt(0)), at);

const ZIP = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
// the old Office binary formats (.doc, .xls)
const OLE = (b: Uint8Array) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const TEXT = (b: Uint8Array) => !b.subarray(0, 8192).includes(0);

const CHECKS: Record<string, (b: Uint8Array) => boolean> = {
  // a PDF may carry a few bytes of junk before its header; readers allow 1 KB
  "application/pdf": (b) => {
    const head = new TextDecoder("latin1").decode(b.subarray(0, 1024));
    return head.includes("%PDF-");
  },
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/gif": (b) => ascii(b, "GIF87a") || ascii(b, "GIF89a"),
  "image/webp": (b) => ascii(b, "RIFF") && ascii(b, "WEBP", 8),
  "image/heic": (b) => ascii(b, "ftyp", 4),
  "image/heif": (b) => ascii(b, "ftyp", 4),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ZIP,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ZIP,
  "application/msword": OLE,
  // Windows browsers label a .csv file with the Excel type, so text passes too
  "application/vnd.ms-excel": (b) => OLE(b) || TEXT(b),
  "text/plain": TEXT,
  "text/csv": TEXT,
};

export function contentMatchesType(mime: string, head: Uint8Array): boolean {
  const check = CHECKS[mime];
  return check ? check(head) : true;
}
