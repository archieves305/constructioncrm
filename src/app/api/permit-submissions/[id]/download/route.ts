import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { recordAudit } from "@/lib/audit/record";
import { clientIp } from "@/lib/rate-limit";
import { readSubmission } from "@/lib/permit-intel/submissions";
import { errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The frozen package, served only when it still matches the hash it was frozen with. Every download is audited. */
export async function GET(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const row = await prisma.permitSubmission.findUnique({ where: { id }, select: { permitId: true } });
  if (!row) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  const scope = await permitInScope(session.user, row.permitId, "read");
  if (scope.denied) return scope.denied;
  try {
    const s = await readSubmission(id);
    await recordAudit({ actorUserId: session.user.id, entityType: "JobPermit", entityId: s.permitId, action: "submission_download", after: { submissionId: id }, ipAddress: clientIp(request), userAgent: request.headers.get("user-agent") });
    return new NextResponse(new Uint8Array(s.bytes), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${s.fileName}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
