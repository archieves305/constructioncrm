import { NextRequest, NextResponse } from "next/server";
import { verifyWorkAuth } from "@/lib/integrations/work/auth";
import { createFromWork, openTasksFor, tasksByIds } from "@/lib/integrations/work/service";
import { workError } from "../respond";

// GET  /api/integrations/work/tasks?ids=a,b,c          status of tasks Work created
// GET  /api/integrations/work/tasks?assigneeEmail=…    open tasks assigned to a person
// POST /api/integrations/work/tasks                    create (idempotent on idempotencyKey):
//      201 { task, created: true } | 200 { task, created: false }
export async function GET(request: NextRequest) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  const sp = request.nextUrl.searchParams;
  try {
    const ids = sp.get("ids");
    if (ids !== null) return NextResponse.json({ tasks: await tasksByIds(ids.split(",").map((s) => s.trim()).filter(Boolean)) });
    const email = sp.get("assigneeEmail");
    if (email) return NextResponse.json({ tasks: await openTasksFor(email) });
    return NextResponse.json({ error: "ids or assigneeEmail is required" }, { status: 400 });
  } catch (e) {
    return workError(e, "tasks:get");
  }
}

export async function POST(request: NextRequest) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const { task, created } = await createFromWork(body);
    return NextResponse.json({ task, created }, { status: created ? 201 : 200 });
  } catch (e) {
    return workError(e, "tasks:post");
  }
}
