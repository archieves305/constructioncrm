import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canWriteProduction } from "@/lib/access/roles";
import { canManageApprovals } from "@/lib/permit-intel/access";
import { runApprovalRead } from "@/lib/permit-intel/approvals";
import { decideAssistItem } from "@/lib/permit-intel/assist-run";
import { indexPermitFileText } from "@/lib/permit-intel/library";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), docType: z.string().max(60) }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("approval") }),
]);

/** A person's decision on what the assistant found: accept with a type, reject, or read it as a product approval. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const row = await prisma.permitAssistItem.findUnique({ where: { id }, select: { permitId: true } });
  if (!row) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const scope = await permitInScope(session.user, row.permitId, "write");
  if (scope.denied) return scope.denied;
  if (!canWriteProduction(session.user.role)) return forbidden();
  const v = await validateBody(request, decisionSchema);
  if (!v.ok) return v.response;
  if (v.data.action === "approval" && !canManageApprovals(session.user.role)) return forbidden();
  try {
    const out = await decideAssistItem(id, v.data, actorOf(session.user));
    const userId = session.user.id;
    if ("approval" in out && out.approval?.readState === "EXTRACTING") {
      const approvalId = out.approval.id;
      after(() => runApprovalRead(approvalId, userId));
    }
    if ("fileId" in out && out.fileId) {
      const fileId = out.fileId;
      after(() => indexPermitFileText(fileId));
    }
    return NextResponse.json(out.item);
  } catch (err) {
    return errorResponse(err);
  }
}
