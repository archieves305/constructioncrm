import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, unauthorized } from "@/lib/auth/helpers";
import { validateBody } from "@/lib/validation/body";
import { genericEstimatePdfKindSchema } from "@/lib/estimates/generic-schema";
import { calculateGenericEstimate } from "@/lib/estimates/generic-calc";
import {
  renderGenericClientEstimatePdf,
  renderGenericInternalEstimatePdf,
  type GenericEstimatePdfData,
} from "@/lib/pdf/generic-estimate";
import { loadEstimateBrand, safeSlug } from "@/lib/pdf/brand";
import { saveFile } from "@/lib/files/storage";
import { FileCategory } from "@/generated/prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; estimateId: string }> },
) {
  const session = await getSession();
  if (!session?.user) return unauthorized();
  const { id, estimateId } = await params;

  const result = await validateBody(request, genericEstimatePdfKindSchema);
  if (!result.ok) return result.response;
  const { kind } = result.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, leadId: id },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
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

  // Recompute from stored inputs so the PDF can never drift from the snapshot.
  const breakdown = calculateGenericEstimate({
    sections: estimate.sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({
        description: i.description,
        unitType: i.unitType,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        isOptional: i.isOptional,
        notes: i.notes,
      })),
    })),
    marginPercent: Number(estimate.marginPercent),
    discountEnabled: estimate.discountEnabled,
    discountPercent: Number(estimate.discountPercent),
    salesTaxPercent: Number(estimate.salesTaxPercent),
  });

  const brand = await loadEstimateBrand();

  const pdfData: GenericEstimatePdfData = {
    estimateNumber: estimate.estimateNumber,
    issueDate: new Date(),
    validityDays: estimate.validityDays,
    name: estimate.name,
    templateCategory: estimate.templateCategory,
    leadId: id,
    notes: estimate.notes,
    exclusions: estimate.exclusions,
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
  };

  const pdfBuffer =
    kind === "client"
      ? await renderGenericClientEstimatePdf(pdfData)
      : await renderGenericInternalEstimatePdf(pdfData);

  let fileName: string;
  if (kind === "client") {
    const brandSlug = safeSlug(brand.companyName);
    const lastSlug = safeSlug(estimate.lead.lastName);
    fileName = `${brandSlug}_Proposal_${estimate.estimateNumber}_${lastSlug}.pdf`;
  } else {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
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
