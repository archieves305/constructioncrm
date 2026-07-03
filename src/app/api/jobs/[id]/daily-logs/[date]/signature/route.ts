import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { badRequest } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import {
  requireJobFieldAccess,
  validateDateParam,
} from "@/lib/labor/route-helpers";
import { getDailyLog } from "@/lib/labor/log-service";
import { saveFile } from "@/lib/files/storage";

type Context = { params: Promise<{ id: string; date: string }> };

const MAX_SIGNATURE_BYTES = 512 * 1024;

const bodySchema = z.object({
  dataUri: z.string().startsWith("data:image/png;base64,").max(1_000_000),
  signedByName: z.string().trim().min(1).max(120),
});

// Crew-lead sign-off, captured on submit. Stored as a PNG through the
// standard storage layer; the daily-report PDF renders it.
export async function POST(request: NextRequest, context: Context) {
  const { id: jobId, date } = await context.params;
  const dateError = validateDateParam(date);
  if (dateError) return dateError;
  const ctx = await requireJobFieldAccess(jobId, "write");
  if ("response" in ctx) return ctx.response;

  const log = await getDailyLog(jobId, date);
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (log.status === "APPROVED") {
    return NextResponse.json(
      { error: "Log is approved — signature is locked" },
      { status: 409 },
    );
  }

  const v = await validateBody(request, bodySchema);
  if (!v.ok) return v.response;

  const base64 = v.data.dataUri.slice("data:image/png;base64,".length);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return badRequest("Invalid signature image");
  }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_SIGNATURE_BYTES) {
    return badRequest("Signature image must be under 512KB");
  }

  const stored = await saveFile(buffer, `signature-${date}.png`);
  await prisma.dailyLog.update({
    where: { id: log.id },
    data: {
      signatureStorageKey: stored.storageKey,
      signedAt: new Date(),
      signedByName: v.data.signedByName,
    },
  });

  return NextResponse.json({ ok: true });
}
