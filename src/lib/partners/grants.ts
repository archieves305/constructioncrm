import { prisma } from "@/lib/db/prisma";
import type { RoleName } from "@/generated/prisma/client";
import type { VaultViewer } from "./vault-access";

/** The vault grant, read fresh from the database on every request so revoking it is instant. */
export async function vaultViewerFor(user: { id: string; role: RoleName }): Promise<VaultViewer> {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { canViewRestrictedDocuments: true } });
  return { role: user.role, canViewRestrictedDocuments: row?.canViewRestrictedDocuments ?? false };
}
