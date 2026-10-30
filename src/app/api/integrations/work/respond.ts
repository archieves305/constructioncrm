import { NextResponse } from "next/server";
import { TaskUpdateError } from "@/lib/tasks/update";
import { TaskLinkError } from "@/lib/tasks/create";
import { logger } from "@/lib/logger";
import { WorkApiError } from "@/lib/integrations/work/service";

/** Map service errors to JSON responses for the CareyOS Work routes. */
export function workError(e: unknown, where: string): NextResponse {
  if (e instanceof WorkApiError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof TaskUpdateError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof TaskLinkError) return NextResponse.json({ error: e.message }, { status: 400 });
  logger.exception(e, { where: `integrations/work/${where}` });
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
