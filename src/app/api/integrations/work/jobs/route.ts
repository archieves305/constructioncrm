import { NextRequest, NextResponse } from "next/server";
import { verifyWorkAuth } from "@/lib/integrations/work/auth";
import { listJobsFor } from "@/lib/integrations/work/service";
import { workError } from "../respond";

// GET /api/integrations/work/jobs?actingEmail=…&q=…
// Open jobs the acting CRM user can see (jobAccessWhere), newest first, max 25.
// 403 when the email is not an active CRM user.
export async function GET(request: NextRequest) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  const actingEmail = request.nextUrl.searchParams.get("actingEmail") ?? "";
  if (!actingEmail) return NextResponse.json({ error: "actingEmail is required" }, { status: 400 });
  try {
    return NextResponse.json({ jobs: await listJobsFor(actingEmail, request.nextUrl.searchParams.get("q") ?? "") });
  } catch (e) {
    return workError(e, "jobs");
  }
}
