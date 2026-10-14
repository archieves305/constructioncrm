import { NextRequest, NextResponse } from "next/server";
import { badRequest, getSession, unauthorized } from "@/lib/auth/helpers";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "@/lib/files/limits";
import { canViewPartners, PARTNER_DENIED_MESSAGE } from "@/lib/partners/access";
import { listVault, uploadDocument } from "@/lib/partners/documents";
import { vaultViewerFor } from "@/lib/partners/grants";
import { CONFIDENTIALITIES, partnerErrorResponse } from "@/lib/partners/validation";
import { canUploadVault } from "@/lib/partners/vault-access";

const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/** The vault: every document type with its current version and history. Restricted rows are listed but locked for those who may not open them. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewPartners(session.user.role)) return NextResponse.json({ error: PARTNER_DENIED_MESSAGE }, { status: 403 });
  const viewer = await vaultViewerFor(session.user);
  return NextResponse.json(await listVault(viewer, { includeInactiveTypes: request.nextUrl.searchParams.get("inactiveTypes") === "1" }));
}

/** File a document or a new version of one. Multipart: file, documentTypeKey, title?, effectiveDate?, expiresAt?, confidentiality?, approvedForExternal?, notes?. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canUploadVault(session.user.role)) return NextResponse.json({ error: "Only office roles file vault documents" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  if (!form) return badRequest("Expected a form");
  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) return badRequest("Choose the file to file");
  if (upload.size > MAX_UPLOAD_BYTES) return badRequest(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  if (!ALLOWED_MIME.has(upload.type)) return badRequest(`That file type cannot be uploaded: ${upload.type || "unknown"}`);
  const documentTypeKey = text(form.get("documentTypeKey"), 60);
  if (!documentTypeKey) return badRequest("Choose what kind of document this is");
  const confidentiality = text(form.get("confidentiality"), 20);
  if (confidentiality && !(CONFIDENTIALITIES as readonly string[]).includes(confidentiality)) return badRequest("confidentiality: INTERNAL, RESTRICTED or SHAREABLE");
  try {
    const viewer = await vaultViewerFor(session.user);
    const doc = await uploadDocument(
      {
        documentTypeKey,
        title: text(form.get("title"), 200),
        effectiveDate: text(form.get("effectiveDate"), 10),
        expiresAt: text(form.get("expiresAt"), 10),
        confidentiality: (confidentiality as (typeof CONFIDENTIALITIES)[number] | null) ?? undefined,
        approvedForExternal: form.get("approvedForExternal") === "true",
        notes: text(form.get("notes"), 2000),
      },
      { buffer: Buffer.from(await upload.arrayBuffer()), name: upload.name, mime: upload.type },
      { ...viewer, id: session.user.id },
    );
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return partnerErrorResponse(err);
  }
}
