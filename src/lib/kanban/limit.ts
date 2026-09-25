// How many cards a board column shows before "Show more". Pure.

export const DEFAULT_COLUMN_LIMIT = 25;

export function splitVisible<T>(items: T[], shown: number): { visible: T[]; hidden: number } {
  const n = Math.max(0, Math.floor(shown));
  if (n >= items.length) return { visible: items, hidden: 0 };
  return { visible: items.slice(0, n), hidden: items.length - n };
}

export function nextShown(current: number, step = DEFAULT_COLUMN_LIMIT): number {
  return Math.max(0, current) + Math.max(1, step);
}
