import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { preflightReport } from "@/lib/permit-intel/preflight-run";
import { runInScope } from "@/lib/permit-intel/run-scope";
import { errorResponse } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/** The readiness report of one run, as a PDF. */
export async function GET(_request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await runInScope(session.user, id, "read");
  if (scope.denied) return scope.denied;
  try {
    const { pdf, fileName } = await preflightReport(id);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName.replace(/[^\w.\- ]+/g, "_")}"` } });
  } catch (err) {
    return errorResponse(err);
  }
}
