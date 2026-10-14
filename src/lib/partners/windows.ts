/**
 * Report windows as office-day keys (yyyy-MM-dd). Pure: the loaders turn a
 * window into instants with `startOfDayIn` / `endOfDayIn`, so a window never
 * drifts across a DST change. Quarter and year are calendar quarter / year.
 */
export type WindowPreset = "30d" | "90d" | "12m" | "month" | "quarter" | "ytd" | "year" | "last-year" | "custom";
export type ReportWindow = { preset: WindowPreset; from: string; to: string; label: string };
export type Period = "week" | "month" | "quarter" | "year";

export const WINDOW_PRESETS: readonly { value: WindowPreset; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "last-year", label: "Last year" },
  { value: "custom", label: "Custom" },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (k: string) => new Date(`${k}T00:00:00.000Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(k: string, n: number): string {
  const d = toUtc(k);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
}

function parts(k: string) {
  return { y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) };
}
const key = (y: number, m: number, d: number) => toKey(new Date(Date.UTC(y, m - 1, d)));
const lastOfMonth = (y: number, m: number) => key(y, m + 1, 0);

/** The window for a preset, ending today unless the preset is a closed period. `custom` needs both dates. */
export function windowFor(preset: WindowPreset, today: string, from?: string | null, to?: string | null): ReportWindow {
  const { y, m } = parts(today);
  const label = WINDOW_PRESETS.find((p) => p.value === preset)?.label ?? preset;
  switch (preset) {
    case "30d":
      return { preset, from: addDays(today, -29), to: today, label };
    case "90d":
      return { preset, from: addDays(today, -89), to: today, label };
    case "12m":
      return { preset, from: addDays(key(y - 1, m, Number(today.slice(8, 10))), 1), to: today, label };
    case "month":
      return { preset, from: key(y, m, 1), to: lastOfMonth(y, m), label };
    case "quarter": {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { preset, from: key(y, q0, 1), to: lastOfMonth(y, q0 + 2), label };
    }
    case "ytd":
      return { preset, from: key(y, 1, 1), to: today, label };
    case "year":
      return { preset, from: key(y, 1, 1), to: key(y, 12, 31), label: String(y) };
    case "last-year":
      return { preset, from: key(y - 1, 1, 1), to: key(y - 1, 12, 31), label: String(y - 1) };
    case "custom": {
      if (!from || !to || !DAY.test(from) || !DAY.test(to)) throw new Error("A custom window needs both dates");
      return from <= to ? { preset, from, to, label: `${from} – ${to}` } : { preset, from: to, to: from, label: `${to} – ${from}` };
    }
  }
}

export function parseWindow(sp: URLSearchParams, today: string, fallback: WindowPreset = "12m"): ReportWindow {
  const raw = sp.get("preset");
  const preset = (WINDOW_PRESETS.some((p) => p.value === raw) || raw === "year" ? raw : fallback) as WindowPreset;
  try {
    return windowFor(preset, today, sp.get("from"), sp.get("to"));
  } catch {
    return windowFor(fallback, today);
  }
}

/** Buckets covering a window, each clipped to it. Weeks start on Monday. */
export function periodsIn(w: { from: string; to: string }, period: Period): { key: string; label: string; from: string; to: string }[] {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  let cursor = w.from;
  let guard = 0;
  while (cursor <= w.to && guard++ < 600) {
    const { y, m } = parts(cursor);
    let start: string;
    let end: string;
    let label: string;
    if (period === "week") {
      const dow = (toUtc(cursor).getUTCDay() + 6) % 7; // Monday = 0
      start = addDays(cursor, -dow);
      end = addDays(start, 6);
      label = `Week of ${start}`;
    } else if (period === "month") {
      start = key(y, m, 1);
      end = lastOfMonth(y, m);
      label = start.slice(0, 7);
    } else if (period === "quarter") {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      start = key(y, q0, 1);
      end = lastOfMonth(y, q0 + 2);
      label = `${y} Q${(q0 + 2) / 3}`;
    } else {
      start = key(y, 1, 1);
      end = key(y, 12, 31);
      label = String(y);
    }
    out.push({ key: start, label, from: start < w.from ? w.from : start, to: end > w.to ? w.to : end });
    cursor = addDays(end, 1);
  }
  return out;
}

/** The period that keeps a window to a readable number of buckets. */
export function defaultPeriod(w: { from: string; to: string }): Period {
  const days = (toUtc(w.to).getTime() - toUtc(w.from).getTime()) / 86_400_000;
  return days <= 100 ? "week" : days <= 400 ? "month" : "quarter";
}
