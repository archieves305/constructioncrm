import type { RoleName } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readFile } from "@/lib/files/storage";
import { logger } from "@/lib/logger";
import { loadEstimateBrand } from "@/lib/pdf/brand";
import { COMPANY } from "@/lib/pdf/company";
import { renderInspectionReportPdf, type ReportBrand } from "@/lib/pdf/quality-inspection-report";
import { isQualityProfile, PROFILE_LABEL } from "./catalog";
import { buildReport, reportFileName, reportPhotoIds } from "./report";
import { readInspection } from "./service";

/** react-pdf draws JPEG and PNG only; a WebP photo prints as "not available". */
const PRINTABLE = new Set(["image/jpeg", "image/png"]);

/**
 * The report PDF for an inspection this viewer may see (404 otherwise, through
 * `readInspection`). Confirmed findings only, whoever asks (`buildReport`).
 */
export async function renderInspectionReport(viewer: { id: string; role: RoleName }, id: string): Promise<{ pdf: Buffer; fileName: string }> {
  const v = await readInspection(viewer, id);
  const model = buildReport({
    number: v.number,
    kindLabel: v.kindLabel,
    status: v.status,
    title: v.title,
    place: v.job?.label ?? v.addressText ?? "No address",
    jobCode: v.job?.code ?? null,
    contractor: v.laborContract?.name ?? null,
    qualityLabel: isQualityProfile(v.qualityProfile) ? PROFILE_LABEL[v.qualityProfile] : v.qualityProfile,
    startedBy: v.startedBy,
    createdAt: v.createdAt,
    acceptedAt: v.acceptedAt,
    acceptedBy: v.acceptedBy,
    acceptOverride: v.acceptOverride,
    areas: v.areas.map((a) => ({ id: a.id, name: a.name, tradeLabel: a.tradeLabel, photoCount: a.photoCount })),
    photos: v.photos.map((p) => ({ id: p.id, areaId: p.areaId, width: p.width, height: p.height })),
    findings: v.findings,
    toReview: v.findings.filter((f) => f.review === "PROPOSED").length,
  });

  const ids = reportPhotoIds(model);
  const rows = ids.length
    ? await prisma.qualityInspectionPhoto.findMany({ where: { id: { in: ids }, inspectionId: id }, select: { id: true, file: { select: { storageKey: true, fileType: true } } } })
    : [];
  const photos = new Map<string, string>();
  for (const r of rows) {
    if (!PRINTABLE.has(r.file.fileType)) continue;
    try {
      const bytes = await readFile(r.file.storageKey);
      photos.set(r.id, `data:${r.file.fileType};base64,${bytes.toString("base64")}`);
    } catch {
      logger.warn("inspection report: photo missing on disk", { inspectionId: id, photoId: r.id });
    }
  }

  const b = await loadEstimateBrand().catch(() => null);
  const cityLine = b ? [b.city, [b.state, b.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const brand: ReportBrand = b
    ? {
        companyName: b.companyName,
        addressLines: [b.addressLine1, b.addressLine2, cityLine].filter((l): l is string => !!l && !!l.trim()),
        phone: b.phone,
        // the stored letterhead email can be another company's (the shared NewCoast brand row); print only KNU's own
        email: b.email && /@knuconstruction\.com$/i.test(b.email) ? b.email : COMPANY.email,
        license: b.gcLicense,
        logoDataUri: b.logoDataUri,
      }
    : null;

  return { pdf: await renderInspectionReportPdf(model, brand, photos), fileName: reportFileName(model) };
}
