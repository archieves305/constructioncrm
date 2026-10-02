import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { applyWorkflow } from "./apply";

/**
 * A new job starts with its workflow.
 *
 * Applying the workflow used to be a separate step someone had to remember
 * after marking a lead Won (it averaged days, and some jobs never got one).
 * The job now gets Core plus the trades its lead's services point at, with
 * the permit left undetermined — "Determine permit requirement" is one of the
 * first steps, and trades, scope, permit and team can all still be changed
 * from the Workflow tab.
 *
 * Best-effort: returns null when nothing could be applied (no published
 * templates, or the engine refused), and the caller carries on as before.
 */

/** Trade templates whose service categories match the lead's services. Pure. */
export function suggestTradeKeys(
  templates: { key: string; categories: string[] }[],
  serviceNames: string[],
): string[] {
  const wanted = new Set(serviceNames.map((s) => s.trim().toLowerCase()).filter(Boolean));
  return templates.filter((t) => t.categories.some((c) => wanted.has(c.toLowerCase()))).map((t) => t.key);
}

export async function autoApplyWorkflowForNewJob(input: {
  jobId: string;
  serviceNames: string[];
  salesRepId: string | null;
  actor: { id: string; role: RoleName };
}): Promise<{ instanceId: string; trades: string[]; created: number } | null> {
  try {
    const templates = await prisma.workflowTemplate.findMany({
      where: { isActive: true, kind: { in: ["CORE", "TRADE"] }, versions: { some: { status: "PUBLISHED" } } },
      select: { key: true, kind: true, serviceCategories: { select: { serviceCategory: { select: { name: true } } } } },
    });
    if (!templates.some((t) => t.kind === "CORE")) return null;

    const trades = suggestTradeKeys(
      templates.filter((t) => t.kind === "TRADE").map((t) => ({ key: t.key, categories: t.serviceCategories.map((c) => c.serviceCategory.name) })),
      input.serviceNames,
    );
    const result = await applyWorkflow({
      subject: { kind: "job", jobId: input.jobId },
      templateKeys: trades,
      permitStatus: "UNDETERMINED",
      scopeToggles: {},
      team: input.salesRepId ? { SALES_REP: input.salesRepId } : undefined,
      actor: input.actor,
    });
    return { instanceId: result.instanceId, trades, created: result.created };
  } catch (err) {
    logger.exception(err, { where: "workflows.autoApplyWorkflowForNewJob", jobId: input.jobId });
    return null;
  }
}
