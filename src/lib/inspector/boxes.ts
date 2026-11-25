/**
 * Boxes the model draws, mapped onto the stored photo. Pure.
 *
 * The model answers in pixels of the image it processed: the image as sent,
 * or — when it is over the model's limits — the size the API shrank it to.
 * `resizedSize` is the API's own rule (platform docs, "Coordinates and
 * bounding boxes"): the largest aspect-preserving size within the long-edge
 * limit and the visual-token budget, one token per 28 × 28 patch. Phone
 * photos (2,000 × 1,500) fit the high-resolution tier unchanged, so their
 * boxes map 1:1.
 */
export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Tier = { maxEdge: number; maxTokens: number };

export const HIGH_RES: Tier = { maxEdge: 2576, maxTokens: 4784 };
export const STANDARD: Tier = { maxEdge: 1568, maxTokens: 1568 };

/** Claude 4.7 and later read images at high resolution; older models at the standard tier. */
export function tierFor(model: string): Tier {
  if (/^claude-(opus|sonnet|haiku|fable|mythos)-[5-9]/.test(model)) return HIGH_RES;
  if (/^claude-opus-4-[7-9]/.test(model)) return HIGH_RES;
  return STANDARD;
}

export function imageTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The size the API processes an image at, before padding. Returns [width, height]. */
export function resizedSize(width: number, height: number, tier: Tier = HIGH_RES): [number, number] {
  const fits = (w: number, h: number) =>
    Math.ceil(w / 28) * 28 <= tier.maxEdge && Math.ceil(h / 28) * 28 <= tier.maxEdge && imageTokens(w, h) <= tier.maxTokens;
  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = resizedSize(height, width, tier);
    return [w, h];
  }
  const aspect = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspect), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundTiesToEven(lo / aspect), 1)];
}

/**
 * A box from the model (`[x1, y1, x2, y2]` in processed pixels) on the stored
 * photo: rescaled, ordered, clamped, rounded. Null when it is not a box (wrong
 * length, not numbers, or nothing left after clamping).
 */
export function toStoredBox(raw: readonly number[], stored: { width: number; height: number }, tier: Tier): Box | null {
  if (raw.length !== 4 || raw.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  const [pw, ph] = resizedSize(stored.width, stored.height, tier);
  const sx = stored.width / pw;
  const sy = stored.height / ph;
  const clampX = (v: number) => Math.min(stored.width, Math.max(0, Math.round(v * sx)));
  const clampY = (v: number) => Math.min(stored.height, Math.max(0, Math.round(v * sy)));
  const x1 = clampX(Math.min(raw[0], raw[2]));
  const x2 = clampX(Math.max(raw[0], raw[2]));
  const y1 = clampY(Math.min(raw[1], raw[3]));
  const y2 = clampY(Math.max(raw[1], raw[3]));
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return { x1, y1, x2, y2 };
}

/** A box a person drew or moved (already in stored pixels): ordered, clamped, at least 4 px. */
export function cleanBox(b: Box, stored: { width: number; height: number }): Box | null {
  const x1 = Math.max(0, Math.min(b.x1, b.x2));
  const x2 = Math.min(stored.width, Math.max(b.x1, b.x2));
  const y1 = Math.max(0, Math.min(b.y1, b.y2));
  const y2 = Math.min(stored.height, Math.max(b.y1, b.y2));
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  return { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) };
}

/** Intersection over union of two boxes (0 when they do not overlap). */
export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const area = (r: Box) => (r.x2 - r.x1) * (r.y2 - r.y1);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function parseBoxes(v: unknown): Box[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b): b is Box => !!b && typeof b === "object" && ["x1", "y1", "x2", "y2"].every((k) => typeof (b as Record<string, unknown>)[k] === "number"));
}
