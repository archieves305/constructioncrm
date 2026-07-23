import { cache } from "react";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { introspect } from "@/lib/sso";
import { logger } from "@/lib/logger";
import type { RoleName } from "@/generated/prisma/client";

/**
 * The auth seam.
 *
 * Identity now comes from CareyOS SSO rather than a local password, but the
 * shape returned here is unchanged, so the ~140 route handlers and pages that
 * call getSession()/requireSession()/requireRole() did not have to move.
 *
 * Division of responsibility:
 *   - CareyOS authenticates, and decides whether this user may use the CRM
 *     at all (`allowed`) and at what level (`appRole`), live on every request.
 *   - The CRM keeps its own User row purely as the anchor for foreign keys —
 *     leads, activity, jobs, files all reference User.id — and as a second
 *     gate: a row deactivated here is denied even if the portal allows it.
 */

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
}

export interface Session {
  user: SessionUser;
}

const ROLE_NAMES: readonly RoleName[] = [
  "ADMIN",
  "MANAGER",
  "SALES_REP",
  "OFFICE_STAFF",
  "MARKETING",
  "READ_ONLY",
  "CREW_LEAD",
];

/**
 * CareyOS stores appRole as an opaque string. We keep its list identical to
 * RoleName, so this is a validation rather than a translation — and an
 * unrecognised value is refused rather than guessed at. The portal already
 * degrades a stale grant to defaultAppRole (READ_ONLY), so reaching here with
 * something unknown means the two lists have genuinely drifted.
 */
function toRoleName(value: string | null): RoleName | null {
  if (!value) return null;
  return (ROLE_NAMES as readonly string[]).includes(value)
    ? (value as RoleName)
    : null;
}

/** "jgarcia@x.com" → { firstName: "Jgarcia", lastName: "" }; "jo.garcia@x" →
 *  { firstName: "Jo", lastName: "Garcia" }. Only ever used when provisioning a
 *  user the CRM has never seen; existing rows keep their real names. */
function namesFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    firstName: cap(parts[0] ?? local),
    lastName: parts.length > 1 ? cap(parts[parts.length - 1]!) : "",
  };
}

// Users are provisioned by CareyOS, so there is no local password to store.
// This is not a bcrypt hash, so bcrypt.compare can never match it.
const SSO_MANAGED_PASSWORD = "sso:careyos";

/**
 * Resolve the SSO identity to a CRM session.
 *
 * Wrapped in React.cache so a single request that touches getSession() from a
 * layout, a page and several helpers introspects the portal once, not N times.
 * The cache is per-request — it never leaks between users.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const result = await introspect();
  if (!result.ok || !result.allowed || !result.user) return null;

  const { email, appRole } = result.user;
  const role = toRoleName(appRole);
  if (!role) {
    logger.warn("SSO returned an unrecognised appRole; denying", {
      email,
      appRole,
    });
    return null;
  }

  let user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  if (!user) {
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    if (!roleRow) {
      logger.error("CRM role row missing for SSO appRole", { email, role });
      return null;
    }
    const { firstName, lastName } = namesFromEmail(email);
    user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash: SSO_MANAGED_PASSWORD,
        roleId: roleRow.id,
      },
      include: { role: true },
    });
    logger.info("provisioned CRM user from SSO", { email, role });
  }

  // A CRM row deactivated locally stays denied regardless of the portal.
  if (!user.isActive) return null;

  // CareyOS is the source of truth for the role. Mirror it onto the row so the
  // rest of the app — assignment pickers, admin lists, reports that query by
  // role — stays consistent with what the session actually grants.
  if (user.role.name !== role) {
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    if (roleRow) {
      await prisma.user.update({
        where: { id: user.id },
        data: { roleId: roleRow.id },
      });
      logger.info("synced CRM role from SSO", {
        email,
        from: user.role.name,
        to: role,
      });
    }
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role,
    },
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireRole(...roles: RoleName[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    throw new Error("Forbidden");
  }
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const ROLE_HIERARCHY: Record<RoleName, number> = {
  ADMIN: 100,
  MANAGER: 80,
  SALES_REP: 60,
  OFFICE_STAFF: 50,
  CREW_LEAD: 45,
  MARKETING: 40,
  READ_ONLY: 10,
};

export function hasMinRole(userRole: RoleName, requiredRole: RoleName): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
