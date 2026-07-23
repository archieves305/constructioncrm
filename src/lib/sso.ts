import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * CareyOS SSO client.
 *
 * The portal at app.careyos.com is the sole identity provider for the fleet.
 * Since the CRM moved to crm.careyos.com it sits inside the `.careyos.com`
 * cookie scope, so it integrates the ordinary way: forward the opaque
 * `careyos_session` cookie to /api/sso/authorize and honour the answer. We
 * never hold CAREYOS_SSO_SECRET and never decode the token ourselves.
 *
 * Authorization is decided live by the portal on every call, against its
 * database rather than the token's claims — so a grant or revoke in the
 * CareyOS admin applies on the user's next request, with no re-login.
 *
 * Portal contract (app/api/sso/authorize/route.ts):
 *   GET /api/sso/authorize?app=<id>   Authorization: Bearer <cookie value>
 *   → { ok, user?: { uid, email, role }, allowed, appRole }
 *   ok=false     token missing/invalid/expired, or a handoff token → send to login
 *   allowed      isActive AND (portal ADMIN OR an AppAccess row for this app)
 *   appRole      the user's role INSIDE the CRM, one of our RoleName values
 */

export const SESSION_COOKIE = "careyos_session";

export interface SsoIdentity {
  /** Portal user id. Stable, but the CRM keys its own User rows off email. */
  uid: string;
  email: string;
  /** CareyOS-level role, "ADMIN" | "USER". NOT the CRM role — see appRole. */
  portalRole: string;
  /** The CRM role. Verbatim from AppEntry.appRoles, which we keep identical
   *  to our RoleName enum so no translation table is needed. Null only if the
   *  portal stops declaring roles for this app. */
  appRole: string | null;
}

export interface AuthorizeResult {
  /** Token present, valid and unexpired. */
  ok: boolean;
  /** Active user, granted this app. */
  allowed: boolean;
  user?: SsoIdentity;
}

const DENIED: AuthorizeResult = { ok: false, allowed: false };

function devIdentity(): SsoIdentity {
  return {
    uid: "dev-bypass",
    email: (env.CAREYOS_DEV_EMAIL ?? "richard@rcareylaw.com").toLowerCase(),
    portalRole: "ADMIN",
    appRole: env.CAREYOS_DEV_ROLE ?? "ADMIN",
  };
}

/**
 * Introspect this request's session against the portal.
 *
 * Fails closed on every error path — missing cookie, non-2xx, malformed body,
 * network failure. If we cannot prove the caller is authorised we treat them
 * as anonymous, never as authenticated.
 */
export async function introspect(): Promise<AuthorizeResult> {
  if (env.CAREYOS_SSO_DEV_BYPASS === "1") {
    return { ok: true, allowed: true, user: devIdentity() };
  }

  // Next 16: cookies() is async.
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return DENIED;

  let res: Response;
  try {
    res = await fetch(
      `${env.CAREYOS_SSO_URL}/api/sso/authorize?app=${encodeURIComponent(env.CAREYOS_APP_ID)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
  } catch {
    return DENIED;
  }

  if (!res.ok) return DENIED;

  let data: {
    ok?: boolean;
    allowed?: boolean;
    appRole?: string | null;
    user?: { uid?: string; email?: string; role?: string };
  };
  try {
    data = await res.json();
  } catch {
    return DENIED;
  }

  if (!data.ok || !data.user?.email || !data.user?.uid) return DENIED;

  return {
    ok: true,
    allowed: Boolean(data.allowed),
    user: {
      uid: String(data.user.uid),
      email: String(data.user.email).toLowerCase(),
      portalRole: String(data.user.role ?? "USER"),
      appRole: data.appRole ?? null,
    },
  };
}

/** Portal login, carrying a return path back into the CRM. */
export function loginUrl(returnPath?: string): string {
  const base = env.CAREYOS_SSO_URL.replace(/\/$/, "");
  const next = `${env.APP_BASE_URL}${returnPath && returnPath.startsWith("/") ? returnPath : "/"}`;
  return `${base}/login?next=${encodeURIComponent(next)}`;
}

/**
 * Portal logout. Ends the shared session for the whole fleet, which is the
 * intent: the cookie is `.careyos.com`-scoped, so signing out of the CRM alone
 * is not something we can offer.
 */
export function logoutUrl(): string {
  return `${env.CAREYOS_SSO_URL.replace(/\/$/, "")}/api/auth/logout`;
}
