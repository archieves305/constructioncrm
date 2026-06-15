import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { hasMinRole } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
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
  if (!hasMinRole(session.user.role, "MANAGER")) return forbidden();

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

  return NextResponse.json(result);
}
