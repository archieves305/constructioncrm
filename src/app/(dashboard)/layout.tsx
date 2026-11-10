import { isCrewRole } from "@/lib/access/roles";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/helpers";
import { loginUrl } from "@/lib/sso";
import { AppShell } from "@/components/layout/app-shell";
import { UsageBeacon } from "@/components/usage/usage-beacon";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session?.user) {
    redirect(loginUrl());
  }

  // Crew leads live in field mode: keep them off office pages entirely. This
  // used to be enforced in middleware, which no longer knows the role — the
  // session is resolved here instead, from the live SSO answer.
  if (isCrewRole(session.user.role)) {
    redirect("/field");
  }

  return (
    <AppShell user={session.user}>
      <UsageBeacon />
      {children}
    </AppShell>
  );
}
