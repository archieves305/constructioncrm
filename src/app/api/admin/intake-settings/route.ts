import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole, badRequest } from "@/lib/auth/helpers";

export async function GET() {
  try {
    await requireRole("ADMIN", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await prisma.intakeSettings.findMany({ orderBy: { createdAt: "desc" } });
  const alertSettings = await prisma.managerAlertSettings.findMany();

  return NextResponse.json({ intakeSettings: settings, alertSettings });
}

export async function POST(request: NextRequest) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (body.type === "intake") {
    const settings = await prisma.intakeSettings.upsert({
      where: { id: body.id || "new" },
      update: {
        name: body.name,
        mailboxAddress: body.mailboxAddress,
        allowedSenders: body.allowedSenders,
        allowedSubjects: body.allowedSubjects,
        processedFolderName: body.processedFolderName,
        pollingIntervalSec: body.pollingIntervalSec || 60,
        sourceMapping: body.sourceMapping,
        isActive: body.isActive ?? true,
        twilioFromNumber: body.twilioFromNumber,
        twilioEnabled: body.twilioEnabled ?? false,
        defaultAssignUserId: body.defaultAssignUserId,
      },
      create: {
        name: body.name || "Default",
        provider: "outlook_graph",
        mailboxAddress: body.mailboxAddress,
        allowedSenders: body.allowedSenders || [],
        processedFolderName: body.processedFolderName || "Processed",
        twilioFromNumber: body.twilioFromNumber,
        twilioEnabled: body.twilioEnabled || false,
        defaultAssignUserId: body.defaultAssignUserId,
      },
    });
    return NextResponse.json(settings);
  }

  if (body.type === "alert") {
    if (!body.userId) return badRequest("userId required");

    const settings = await prisma.managerAlertSettings.upsert({
      where: { userId: body.userId },
      update: {
        smsEnabled: body.smsEnabled ?? true,
        smsPhoneNumber: body.smsPhoneNumber,
        emailEnabled: body.emailEnabled ?? true,
        alertEmail: body.alertEmail,
        slaThresholdMinutes: body.slaThresholdMinutes || 5,
      },
      create: {
        userId: body.userId,
        smsEnabled: body.smsEnabled ?? true,
        smsPhoneNumber: body.smsPhoneNumber,
        emailEnabled: body.emailEnabled ?? true,
        alertEmail: body.alertEmail,
        slaThresholdMinutes: body.slaThresholdMinutes || 5,
      },
    });
    return NextResponse.json(settings);
  }

  return badRequest("type must be 'intake' or 'alert'");
}
