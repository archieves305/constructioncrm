/**
 * One byte range from a request's Range header, for serving a stored file in
 * pieces (iPhones and Safari play a video only when the server answers ranges).
 * Pure. Returns null when there is no usable range (serve the whole file) and
 * "unsatisfiable" when the range lies outside the file (answer 416).
 * Only a single range is honoured; a list of ranges is served whole.
 */
export type ByteRange = { start: number; end: number };

export function parseRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // the last n bytes
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}
