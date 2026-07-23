import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/helpers";
import { loginUrl } from "@/lib/sso";

/**
 * Admin section gate.
 *
 * Middleware used to enforce this by reading the role off the NextAuth JWT.
 * Under SSO the edge has no role to read, so the check moves here — where the
 * session is resolved live from the portal on every request. Strictly stronger
 * than before: a revoked grant now takes effect on the next page load rather
 * than when a stale token happens to expire.
 *
 * The admin API routes enforce their own requireRole() independently; this
 * only stops the pages rendering.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session?.user) {
    redirect(loginUrl("/admin"));
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    redirect("/");
  }

  return <>{children}</>;
}
