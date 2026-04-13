import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import { ActionPanel } from "./action-panel";

export default async function QuickActionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await prisma.trackedActionLink.findUnique({ where: { token } });
  if (!link) notFound();
  if (link.expiresAt < new Date()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Link Expired</h1>
          <p className="text-gray-600">This action link has expired. Open the CRM directly.</p>
        </div>
      </div>
    );
  }

  const lead = await prisma.lead.findUnique({
    where: { id: link.leadId },
    select: {
      id: true,
      fullName: true,
      primaryPhone: true,
      email: true,
      propertyAddress1: true,
      city: true,
      state: true,
      currentStage: { select: { name: true } },
      services: { include: { serviceCategory: true } },
      notesSummary: true,
      createdAt: true,
    },
  });

  if (!lead) notFound();

  // Get all tracked links for this lead+user
  const allLinks = await prisma.trackedActionLink.findMany({
    where: { leadId: link.leadId, userId: link.userId },
    select: { token: true, actionType: true, clickedAt: true },
  });

  const linkMap = Object.fromEntries(allLinks.map((l) => [l.actionType, { token: l.token, clicked: !!l.clickedAt }]));

  // Serialize Date for client component
  const serializedLead = {
    ...lead,
    createdAt: lead.createdAt.toISOString(),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <ActionPanel lead={serializedLead} linkMap={linkMap} currentToken={token} />
    </div>
  );
}
