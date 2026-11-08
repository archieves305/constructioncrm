/**
 * What a crash report may carry off the phone. Pure, so it is tested without
 * the app. A report keeps the error, the stack, the app version and the
 * screens visited; it never carries a request or response body, a query
 * string, console text, an email, a name, or the sign-in token.
 */
type Crumb = { category?: string; type?: string; message?: string; data?: Record<string, unknown> };
type Event = {
  request?: unknown;
  user?: { id?: string; email?: string; username?: string; ip_address?: string } | null;
  extra?: unknown;
  breadcrumbs?: Crumb[];
  contexts?: Record<string, unknown>;
};

const TOKENISH = /(bearer\s+)[a-z0-9._~+/=-]{8,}/gi;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** A URL without its query string or fragment. */
export function stripQuery(url: unknown): unknown {
  return typeof url === "string" ? url.replace(/[?#].*$/, "") : url;
}

export function scrubText(s: string): string {
  return s.replace(TOKENISH, "$1[token]").replace(EMAIL, "[email]");
}

export function scrubBreadcrumb<C extends Crumb>(c: C): C | null {
  if (c.category === "console") return null; // console text can hold anything
  const data = c.data ? { ...c.data } : undefined;
  if (data) {
    for (const k of ["url", "to", "from"]) if (k in data) data[k] = stripQuery(data[k]);
    for (const k of ["body", "request_body", "response_body", "params"]) delete data[k];
  }
  return { ...c, ...(c.message ? { message: scrubText(c.message) } : {}), ...(data ? { data } : {}) };
}

export function scrubEvent<E extends Event>(e: E): E {
  const out: E = { ...e };
  delete out.request;
  delete out.extra;
  if (out.user) out.user = out.user.id ? { id: out.user.id } : null;
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb).filter((c): c is Crumb => c !== null);
  return out;
}
