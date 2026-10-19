import { NextRequest, NextResponse, after } from "next/server";
import { getSession, unauthorized, forbidden, badRequest } from "@/lib/auth/helpers";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { actorOf, errorResponse } from "@/lib/permit-intel/route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/files/storage";
import { createApproval, listApprovals, runApprovalRead } from "@/lib/permit-intel/approvals";
import { AI_RATE } from "@/lib/permit-intel/route";

/** The repository, searched by number, manufacturer, product or model. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (session.user.role === "CREW_LEAD") return forbidden();
  const p = request.nextUrl.searchParams;
  const q = p.get("q");
  if (q && q.length > 120) return badRequest("The search is too long");
  return NextResponse.json(await listApprovals({ q, category: p.get("category"), authority: p.get("authority"), hvhz: p.get("hvhz") === "1", expiring: p.get("expiring") === "1", includeInactive: p.get("all") === "1" }));
}

/** Add an approval: the PDF is stored and the AI reads it after the answer. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageApprovals(session.user.role)) return forbidden();
  const limited = enforceRateLimit(request, { name: "permit-ai", identifier: session.user.id, ...AI_RATE });
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("Choose the approval document (a PDF)");
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return badRequest(`The document must be a PDF under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  try {
    const a = await createApproval({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, actorOf(session.user));
    if (a.readState === "EXTRACTING") after(() => runApprovalRead(a.id, session.user.id));
    return NextResponse.json(a, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
