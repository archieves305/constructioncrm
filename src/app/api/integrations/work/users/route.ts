import { NextRequest, NextResponse } from "next/server";
import { verifyWorkAuth } from "@/lib/integrations/work/auth";
import { listActiveUsers } from "@/lib/integrations/work/service";

// GET /api/integrations/work/users — active CRM users (id, email, name), so
// Work can offer only assignees who exist here. Matching is by email.
export async function GET(request: NextRequest) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  return NextResponse.json({ users: await listActiveUsers() });
}
