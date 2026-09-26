/**
 * `/pipeline` and `/production` used to be pages of their own; they are now
 * the board view of `/leads` and `/jobs`. Old bookmarks keep working: every
 * query param travels along and `view=board` is added.
 */
export function boardRedirectUrl(base: "/leads" | "/jobs", params: Record<string, string | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) sp.append(k, one);
  }
  sp.set("view", "board");
  return `${base}?${sp.toString()}`;
}
