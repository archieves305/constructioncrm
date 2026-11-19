import { after, NextRequest, NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { canManagePartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { partnerErrorResponse } from "@/lib/partners/validation";
import { guardProject } from "@/lib/bids/access";
import { runProposalExtraction, uploadProposal } from "@/lib/bids/proposals";

/**
 * Upload Estimate: the proposal file (`file`), optional supporting files
 * (`supporting`, repeatable), optional pasted text (`text`) and optional
 * `projectId`. The AI reads it in the background; the answer is the version
 * to open (the same file again opens the version it made before).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canManagePartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the estimate as a file upload" }, { status: 400 });
  }
  const main = form.get("file");
  if (!(main instanceof File)) return NextResponse.json({ error: "file: attach the estimate or proposal" }, { status: 400 });
  const projectId = (form.get("projectId") as string | null) || null;
  if (projectId) {
    const hidden = await guardProject(session.user, projectId);
    if (hidden) return hidden;
  }
  const supporting = form.getAll("supporting").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5);
  const toUpload = async (f: File) => ({ name: f.name, type: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) });
  try {
    const res = await uploadProposal({ file: await toUpload(main), supporting: await Promise.all(supporting.map(toUpload)), supportingText: ((form.get("text") as string | null) ?? "").slice(0, 100_000) || null, projectId }, session.user.id);
    if (!res.duplicate) after(() => runProposalExtraction(res.versionId, session.user.id));
    return NextResponse.json(res, { status: res.duplicate ? 200 : 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
