import { NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canManageRoofPricing, ROOF_PRICING_DENIED } from "@/lib/roofing/access";

import { ruleValueProblem } from "@/lib/roofing/engine/resolve";
import { listRules, resetRule, ruleDef, setRule } from "@/lib/roofing/price-book";
import { setRuleSchema } from "@/lib/roofing/price-book-validation";

/** Change a rule's number or switch it off. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  const { key } = await params;
  const def = ruleDef(key);
  if (!def) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  const body = await validateBody(request, setRuleSchema);
  if (!body.ok) return body.response;
  const problem = ruleValueProblem(def.kind, body.data.value);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  await setRule(key, body.data, session.user.id);
  return NextResponse.json((await listRules()).find((r) => r.key === key));
}

/** Back to the rule as written. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManageRoofPricing(session.user.role)) return NextResponse.json({ error: ROOF_PRICING_DENIED }, { status: 403 });

  const { key } = await params;
  if (!ruleDef(key)) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  await resetRule(key, session.user.id);
  return NextResponse.json((await listRules()).find((r) => r.key === key));
}
