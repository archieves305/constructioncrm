/**
 * Where a CRM link goes on the phone: a job or a task opens in the app; any
 * other record (a lead, a permit, a case…) opens the CRM's web page. Pure.
 */
export type PhoneLink = { kind: "job"; id: string } | { kind: "task"; id: string } | { kind: "web"; path: string };

export function phoneLink(href: string): PhoneLink {
  const [path, query = ""] = href.split("?");
  const job = path.match(/^\/jobs\/([a-z0-9]+)\/?$/i);
  if (job) return { kind: "job", id: job[1] };
  const params = new URLSearchParams(query);
  if (path === "/tasks" && params.get("task")) return { kind: "task", id: params.get("task")! };
  const task = path.match(/^\/tasks\/([a-z0-9]+)\/?$/i);
  if (task) return { kind: "task", id: task[1] };
  return { kind: "web", path: href.startsWith("/") ? href : `/${href}` };
}

/** "$179,040", "$1.2M" for big numbers on a tile. */
export function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 && Math.round(abs) > 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}
