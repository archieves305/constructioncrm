import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getSession, unauthorized, forbidden } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { WORKFLOW_ROLE_VALUES } from "@/lib/validators/workflow";
import { canCreateCase } from "@/lib/violations/access";
import { previewTemplateForIntake } from "@/lib/violations/workflow";
import { violationErrorResponse } from "@/lib/violations/route-helpers";

const schema = z.object({
  templateKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
  permitStatus: z.enum(["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"]).default("UNDETERMINED"),
  scopeToggles: z.record(z.string(), z.boolean()).default({}),
  caseManagerId: z.string().min(1).nullable().optional(),
  team: z.partialRecord(z.enum(WORKFLOW_ROLE_VALUES), z.string().min(1).nullable()).optional(),
});

/** The intake review step: what the template would generate, before the case exists. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canCreateCase(session.user.role)) return forbidden();
  const parsed = await validateBody(request, schema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await previewTemplateForIntake({ ...parsed.data, caseManagerId: parsed.data.caseManagerId ?? null }));
  } catch (err) {
    return violationErrorResponse(err) ?? Promise.reject(err);
  }
}
