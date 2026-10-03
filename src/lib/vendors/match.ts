/**
 * Matching a payee as it arrived (typed, or a bank memo) to a vendor.
 *
 * Pure and client-safe. The payee text on an expense is never rewritten; a
 * match only fills `JobExpense.vendorId`.
 *
 * A pattern matches when the normalised text contains it at a word start —
 * "home depot" matches "the home depot hollywood fl" and never "nohome depot".
 * The end is left open on purpose: bank memos run the payee into the city
 * ("wasteline solutions,fort lauderda fl", "carmel dumpster rentlakeland fl").
 * The longest pattern wins, so "home depot pro" beats "home depot".
 */

/** Shorter patterns ("fl", "co") would match half the bank feed. */
export const MIN_PATTERN_LENGTH = 3;

/** Lowercase, punctuation to spaces, spaces collapsed. "HomeDepot.com 800-430" → "homedepot com 800 430". */
export function normalisePayee(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type AliasRow = { vendorId: string; pattern: string };

/** Does the (already normalised) text contain the pattern at a word start? */
export function patternMatches(normalisedText: string, pattern: string): boolean {
  if (pattern.length < MIN_PATTERN_LENGTH) return false;
  return ` ${normalisedText}`.includes(` ${pattern}`);
}

/**
 * The vendor a payee text belongs to, or null. `aliases` carries every stored
 * alias plus each vendor's own normalised name (`aliasRows`).
 */
export function matchVendor(text: string | null | undefined, aliases: readonly AliasRow[]): string | null {
  const normalised = normalisePayee(text);
  if (!normalised) return null;
  let best: AliasRow | null = null;
  for (const alias of aliases) {
    if (!patternMatches(normalised, alias.pattern)) continue;
    if (!best || alias.pattern.length > best.pattern.length) best = alias;
  }
  return best?.vendorId ?? null;
}

/** Stored aliases plus each vendor's own name, normalised, as one list to match against. */
export function aliasRows(
  vendors: readonly { id: string; name: string; aliases?: readonly { pattern: string }[] }[],
): AliasRow[] {
  const rows: AliasRow[] = [];
  for (const v of vendors) {
    const own = normalisePayee(v.name);
    if (own.length >= MIN_PATTERN_LENGTH) rows.push({ vendorId: v.id, pattern: own });
    for (const a of v.aliases ?? []) rows.push({ vendorId: v.id, pattern: a.pattern });
  }
  return rows;
}

export type PayeeGroup = { key: string; text: string; count: number; total: number; jobs: number };

/**
 * Unlinked expenses grouped by normalised payee — the Unmatched tab's rows.
 * `text` is the most common spelling in the group.
 */
export function groupPayees(
  rows: readonly { vendor: string | null; amount: number; jobId: string }[],
): PayeeGroup[] {
  const groups = new Map<string, { spellings: Map<string, number>; count: number; total: number; jobs: Set<string> }>();
  for (const r of rows) {
    const key = normalisePayee(r.vendor);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { spellings: new Map(), count: 0, total: 0, jobs: new Set() };
      groups.set(key, g);
    }
    const spelling = (r.vendor ?? "").trim();
    g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + 1);
    g.count += 1;
    g.total += r.amount;
    g.jobs.add(r.jobId);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      text: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: g.count,
      total: Math.round(g.total * 100) / 100,
      jobs: g.jobs.size,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
