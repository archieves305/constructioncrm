import { NextRequest } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { canViewContractTemplates } from "@/lib/customer-contracts/access";
import { getVersion, parseTemplateContent } from "@/lib/customer-contracts/templates";
import { buildSampleSnapshot } from "@/lib/customer-contracts/preview";
import { contractErrorResponse, pdfResponse } from "@/lib/customer-contracts/route-helpers";
import { loadEstimateBrand } from "@/lib/pdf/brand";
import { renderCustomerContractPdf } from "@/lib/pdf/customer-contract";
import { contractTemplateContentSchema } from "@/lib/validators/customer-contract";

// POST — a sample PDF. With a body, previews the unsaved editor content;
// without one, the stored version.
export async function POST(request: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  if (!canViewContractTemplates(session.user.role)) return forbidden();
  const { vid } = await params;
  try {
    const version = await getVersion(vid);
    let content = parseTemplateContent(version);
    const raw = await request.text();
    if (raw.trim()) {
      const v = await validateBody(new Request(request.url, { method: "POST", headers: request.headers, body: raw }), contractTemplateContentSchema);
      if (!v.ok) return v.response;
      content = v.data;
    }
    const brand = await loadEstimateBrand();
    const snapshot = buildSampleSnapshot({ key: version.template.key, version: version.version, versionId: version.id, content }, brand);
    const pdf = await renderCustomerContractPdf(snapshot);
    return pdfResponse(pdf, `${version.template.key}-v${version.version}-preview.pdf`);
  } catch (err) {
    return contractErrorResponse(err, "contract-template-versions.preview");
  }
}
