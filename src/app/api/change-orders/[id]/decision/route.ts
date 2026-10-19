import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { canDecideChangeOrder } from "@/lib/access/roles";
import { validateBody } from "@/lib/validation/body";
import { recordAudit } from "@/lib/audit/record";
import { decideChangeOrderById } from "@/lib/services/change-orders";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  // Who approved/rejected (e.g. the customer's name from a meeting). Optional —
  // defaults to the acting staff member.
  name: z.string().trim().max(200).nullable().optional(),
  reason: z.string().max(4000).nullable().optional(),
});

// POST /api/change-orders/[id]/decision — record a decision internally, e.g. a
// change order approved in a meeting. Admin/Manager only.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canDecideChangeOrder(session.user.role)) return forbidden();

  const { id } = await context.params;
  const v = await validateBody(request, schema);
  if (!v.ok) return v.response;

  const name =
    v.data.name?.trim() ||
    `${session.user.firstName} ${session.user.lastName} (staff)`;

  const result = await decideChangeOrderById(
    id,
    v.data.decision,
    name,
    v.data.reason,
    session.user.id,
  );

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "already_decided"
          ? 409
          : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  await recordAudit({
    actorUserId: session.user.id,
    entityType: "change_order",
    entityId: id,
    action: "change_order_decision",
    after: { decision: v.data.decision, name, reason: v.data.reason ?? null, billing: result.ok ? (result as { billing?: string }).billing ?? null : null },
  });
  return NextResponse.json(result);
}
