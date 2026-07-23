import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/sso";

/**
 * /login is now a bounce to CareyOS.
 *
 * The CRM no longer authenticates anyone: passwords, lockout and reset all
 * live in the portal. This route stays because bookmarks, old emails and the
 * `callbackUrl=` links NextAuth used to emit still point here.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // Only honour a relative path. An absolute one would turn this into an open
  // redirector, bouncing users to whatever host lands in the query string.
  const target =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";
  redirect(loginUrl(target));
}
