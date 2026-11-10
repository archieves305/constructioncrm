import { NextRequest, NextResponse } from "next/server";
import { verifyWorkAuth } from "@/lib/integrations/work/auth";
import { taskFileForWork } from "@/lib/integrations/work/files";
import { workError } from "../../../../respond";

// GET /api/integrations/work/tasks/:id/files/:fileId — the file's bytes (a task Work created only).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const authFail = verifyWorkAuth(request);
  if (authFail) return authFail;
  const { id, fileId } = await params;
  try {
    const f = await taskFileForWork(id, fileId);
    return new NextResponse(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": f.fileType,
        "Content-Length": String(f.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^\w.\- ()]+/g, "_")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return workError(e, "tasks:file");
  }
}
