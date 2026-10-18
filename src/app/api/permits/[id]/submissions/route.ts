import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canSubmitPermit } from "@/lib/permit-intel/access";
import { freezeSubmission } from "@/lib/permit-intel/submissions";
import { submissionSchema } from "@/lib/permit-intel/validation";
import { actorOf, errorResponse, permitInScope } from "@/lib/permit-intel/route";

type Context = { params: Promise<{ id: string }> };

/**
 * Freeze the chosen documents as the package sent to the building
 * department. Writes the zip, its hashes and the next review cycle; the
 * documents in it are locked from then on.
 */
export async function POST(request: NextRequest, { params }: Context) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id } = await params;
  const scope = await permitInScope(session.user, id, "write");
  if (scope.denied) return scope.denied;
  if (!canSubmitPermit(session.user, scope.permit)) return forbidden();
  const v = await validateBody(request, submissionSchema);
  if (!v.ok) return v.response;
  try {
    return NextResponse.json(await freezeSubmission(id, v.data, actorOf(session.user)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
