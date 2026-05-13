import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { estimatePdfKindSchema } from "@/lib/estimates/schema";
import {
  calculateEstimate,
  type RoofTypeLine,
} from "@/lib/estimates/calc";
import {
  renderClientEstimatePdf,
  renderInternalEstimatePdf,
  type EstimatePdfData,
  type EstimateBrand,
} from "@/lib/pdf/estimate";
import { saveFile, readFile } from "@/lib/files/storage";
import { FileCategory } from "@/generated/prisma/client";

async function loadBrand(): Promise<EstimateBrand> {
  let brand = await prisma.roofingBrand.findUnique({ where: { id: "default" } });
  if (!brand) {
    brand = await prisma.roofingBrand.create({
      data: { id: "default", companyName: "NewCoast Roofing" },
    });
  }

  // Encode the logo as a data URI so @react-pdf can render it without
  // depending on a live HTTP fetch at PDF-generation time.
  let logoDataUri: string | null = null;
  if (brand.logoStorageKey) {
    try {
      const buf = await readFile(brand.logoStorageKey);
      const ext = path.extname(brand.logoStorageKey).toLowerCase();
      const mime =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/png";
      logoDataUri = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      logoDataUri = null;
    }
  }

  return {
    companyName: brand.companyName,
    addressLine1: brand.addressLine1,
    addressLine2: brand.addressLine2,
    city: brand.city,
    state: brand.state,
    zip: brand.zip,
    phone: brand.phone,
    email: brand.email,
    website: brand.website,
    roofingLicense: brand.roofingLicense,
    gcLicense: brand.gcLicense,
    logoDataUri,
    paymentDepositPercent: Number(brand.paymentDepositPercent),
    paymentProgressPercent: Number(brand.paymentProgressPercent),
    paymentFinalPercent: Number(brand.paymentFinalPercent),
  };
}

function safeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Client";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const result = await validateBody(request, estimatePdfKindSchema);
  if (!result.ok) return result.response;
  const { kind } = result.data;

  const estimate = await prisma.roofEstimate.findFirst({
    where: { id: estimateId, leadId: id },
    include: {
      lead: {
        select: {
          fullName: true,
          lastName: true,
          email: true,
          primaryPhone: true,
          propertyAddress1: true,
          propertyAddress2: true,
          city: true,
          state: true,
          zipCode: true,
        },
      },
    },
  });
  if (!estimate) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  const breakdown = calculateEstimate({
    roofTypes: estimate.roofTypesJson as unknown as RoofTypeLine[],
    materialCost: Number(estimate.materialCost),
    materialSelection: estimate.materialSelection,
    permitFee: Number(estimate.permitFee),
    dumpsterFee: Number(estimate.dumpsterFee),
    tearOffFee: Number(estimate.tearOffFee),
    deckingFee: Number(estimate.deckingFee),
    underlaymentFee: Number(estimate.underlaymentFee),
    flashingVentFee: Number(estimate.flashingVentFee),
    skylightChimneyFee: Number(estimate.skylightChimneyFee),
    guttersFee: Number(estimate.guttersFee),
    miscLabel: estimate.miscLabel,
    miscFee: Number(estimate.miscFee),
    marginPercent: Number(estimate.marginPercent),
    discountEnabled: estimate.discountEnabled,
    discountPercent: Number(estimate.discountPercent),
    salesTaxPercent: Number(estimate.salesTaxPercent),
  });

  const brand = await loadBrand();

  const pdfData: EstimatePdfData = {
    estimateNumber: estimate.estimateNumber,
    issueDate: new Date(),
    validityDays: estimate.validityDays,
    specialTerms: estimate.specialTerms,
    customer: {
      fullName: estimate.lead.fullName,
      email: estimate.lead.email,
      phone: estimate.lead.primaryPhone,
      propertyAddress1: estimate.lead.propertyAddress1,
      propertyAddress2: estimate.lead.propertyAddress2,
      city: estimate.lead.city,
      state: estimate.lead.state,
      zipCode: estimate.lead.zipCode,
    },
    breakdown,
    brand,
    proposal: {
      existingRoofType: estimate.existingRoofType,
      proposedRoofTypeOverride: estimate.proposedRoofTypeOverride,
      underlaymentType: estimate.underlaymentType,
      permitIncluded: estimate.permitIncluded,
      projectDurationText: estimate.projectDurationText,
      plywoodSheetsIncluded: estimate.plywoodSheetsIncluded,
      additionalPlywoodPrice:
        estimate.additionalPlywoodPrice != null
          ? Number(estimate.additionalPlywoodPrice)
          : null,
      workmanshipWarrantyYears: estimate.workmanshipWarrantyYears,
      manufacturerWarranty: estimate.manufacturerWarranty,
      isEstimateOnly: estimate.isEstimateOnly,
    },
  };

  const pdfBuffer =
    kind === "client"
      ? await renderClientEstimatePdf(pdfData)
      : await renderInternalEstimatePdf(pdfData);

  let fileName: string;
  if (kind === "client") {
    const brandSlug = safeSlug(brand.companyName);
    const lastSlug = safeSlug(estimate.lead.lastName);
    fileName = `${brandSlug}_Proposal_${estimate.estimateNumber}_${lastSlug}.pdf`;
  } else {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);
    fileName = `${estimate.estimateNumber}-Internal-${stamp}.pdf`;
  }

  const stored = await saveFile(pdfBuffer, fileName);

  const fileRecord = await prisma.file.create({
    data: {
      leadId: id,
      fileName,
      fileType: "application/pdf",
      fileSize: stored.bytes,
      storageKey: stored.storageKey,
      category: FileCategory.ESTIMATE,
      uploadedByUserId: session.user.id,
    },
    include: {
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(
    { file: fileRecord, kind, estimateNumber: estimate.estimateNumber },
    { status: 201 },
  );
}
