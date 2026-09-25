/**
 * Which sidebar item is "on" for a URL. Longest matching path wins (so
 * /reports/labor lights "Labor Reports", not "Reports"), and an item whose
 * href carries query keys is on only when every one matches (so
 * /violations/list?view=overdue lights "Overdue" and not "All Cases").
 */
export type NavMatchItem = { href: string; match?: "exact" | "prefix" };

function split(href: string): { path: string; query: URLSearchParams } {
  const i = href.indexOf("?");
  return i < 0 ? { path: href, query: new URLSearchParams() } : { path: href.slice(0, i), query: new URLSearchParams(href.slice(i + 1)) };
}

function pathMatches(pathname: string, item: NavMatchItem): boolean {
  const { path } = split(item.href);
  if (pathname === path) return true;
  if (item.match === "exact" || path === "/") return false;
  return pathname.startsWith(`${path}/`);
}

export function isNavActive(pathname: string, search: URLSearchParams, item: NavMatchItem, all: NavMatchItem[]): boolean {
  if (!pathMatches(pathname, item)) return false;
  const { path, query } = split(item.href);
  // Every query key on the item must match the URL.
  for (const [k, v] of query.entries()) if (search.get(k) !== v) return false;
  // An item with no query is off when a sibling with the same path has a query that matches.
  if ([...query.keys()].length === 0) {
    const sibling = all.some((o) => o !== item && split(o.href).path === path && [...split(o.href).query.entries()].length > 0 && [...split(o.href).query.entries()].every(([k, v]) => search.get(k) === v));
    if (sibling) return false;
  }
  // Longest matching path wins among items that match this URL.
  const longest = Math.max(...all.filter((o) => pathMatches(pathname, o)).map((o) => split(o.href).path.length));
  return path.length === longest;
}
