"use client";

import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";

/**
 * The drag sensors and collision rule every board and the calendar share.
 *
 * Mouse + Touch instead of one Pointer sensor: a single distance constraint
 * fights horizontal touch-scrolling on a phone. The 6px mouse distance is the
 * click-vs-drag rule — a click still opens the card. Keyboard drags take a
 * coordinate getter because "next column" and "next day cell" are different
 * geometry.
 *
 * `keyboardCodes` lets a caller reserve Enter for "open" (the calendar): by
 * default dnd-kit starts a drag on Space *and* Enter.
 */
export function useKitSensors(coordinateGetter: KeyboardCoordinateGetter, opts: { enterOpens?: boolean } = {}) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
      ...(opts.enterOpens ? { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } } : {}),
    }),
  );
}

/** Pointer inside a droppable wins; then any rect overlap; then the nearest centre. */
export const kitCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) return within;
  const rects = rectIntersection(args);
  return rects.length > 0 ? rects : closestCenter(args);
};
