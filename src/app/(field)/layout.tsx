import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { redirect } from "next/navigation";
import { FieldShell } from "@/components/field/field-shell";

// Field mode: a minimal, touch-first shell for iPads at the jobsite.
// Deliberately NOT the dashboard AppShell — its sidebar renders at md: (an
// iPad landscape width) and exposes office navigation to crew leads.
const FIELD_ROLES = new Set(["ADMIN", "MANAGER", "OFFICE_STAFF", "CREW_LEAD", "READ_ONLY"]);

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }
  if (!FIELD_ROLES.has(session.user.role)) {
    redirect("/");
  }

  return <FieldShell user={session.user}>{children}</FieldShell>;
}
