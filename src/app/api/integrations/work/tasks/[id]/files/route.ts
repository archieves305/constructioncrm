import { NextRequest, NextResponse } from "next/server";
import { verifyWorkAuth } from "@/lib/integrations/work/auth";
import { taskFilesForWork } from "@/lib/integrations/work/files";
import { workError } from "../../../respond";

// GET /api/integrations/work/tasks/:id/files — photos / PDFs on a task Work created.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  const { id } = await params;
  try {
    return NextResponse.json({ files: await taskFilesForWork(id) });
  } catch (e) {
    return workError(e, "tasks:files");
  }
}
