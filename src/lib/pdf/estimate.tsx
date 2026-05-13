import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  type EstimateBreakdown,
  MATERIAL_LABELS,
} from "@/lib/estimates/calc";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#111",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  logo: { width: 90, height: 68, objectFit: "contain" },
  brandBlock: { flexDirection: "row", gap: 12, alignItems: "center" },
  companyName: { fontSize: 16, fontWeight: 700 },
  docLabel: { fontSize: 16, fontWeight: 700, color: "#0f766e" },
  internalLabel: { fontSize: 18, fontWeight: 700, color: "#b91c1c" },
  muted: { color: "#6b7280", fontSize: 9.5 },
  tiny: { color: "#6b7280", fontSize: 8.5 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: 6,
    color: "#0f766e",
    borderBottomWidth: 1,
    borderBottomColor: "#0f766e",
    paddingBottom: 2,
  },
  bold: { fontWeight: 700 },
  bullet: { marginLeft: 10, marginBottom: 3 },
  rowLine: { flexDirection: "row", marginBottom: 2 },
  rowLabel: { width: 150, color: "#6b7280" },
  rowValue: { flex: 1 },
  title: {
    fontSize: 22,
    fontWeight: 700,
    textAlign: "center",
    marginVertical: 14,
    color: "#0f766e",
  },
  subtitle: {
    fontSize: 10,
    textAlign: "center",
    color: "#6b7280",
    marginBottom: 18,
  },
  totalBox: {
    marginTop: 8,
    marginBottom: 8,
    padding: 14,
    backgroundColor: "#ecfdf5",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#10b981",
  },
  totalLabel: { fontSize: 10, color: "#065f46", textTransform: "uppercase" },
  totalValue: { fontSize: 24, fontWeight: 700, color: "#047857", marginTop: 4 },
  payRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 2,
  },
  lineHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 4,
    marginTop: 8,
    fontWeight: 700,
    fontSize: 10,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  lineRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  colDesc: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colRate: { flex: 1, textAlign: "right" },
  colAmount: { flex: 1, textAlign: "right" },
  internalTotalBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#fef2f2",
    borderRadius: 4,
  },
  internalTotalLabel: {
    fontSize: 10,
    color: "#7f1d1d",
    textTransform: "uppercase",
  },
  internalTotalValue: {
    fontSize: 24,
    fontWeight: 700,
    color: "#991b1b",
    marginTop: 4,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  watermark: {
    position: "absolute",
    top: 16,
    right: 48,
    fontSize: 9,
    color: "#b91c1c",
    fontWeight: 700,
  },
  estimateOnlyBanner: {
    backgroundColor: "#fef3c7",
    color: "#78350f",
    padding: 6,
    textAlign: "center",
    marginBottom: 10,
    fontSize: 10,
    fontWeight: 700,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 8,
    color: "#9ca3af",
  },
  footerNote: {
    position: "absolute",
    bottom: 36,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 8,
    fontStyle: "italic",
    color: "#9ca3af",
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    right: 48,
    fontSize: 8,
    color: "#9ca3af",
  },
  numberedItem: {
    flexDirection: "row",
    marginBottom: 6,
  },
  numberCol: { width: 22, fontWeight: 700 },
  itemBody: { flex: 1 },
  sigBlock: {
    marginTop: 18,
    paddingTop: 10,
  },
  sigLine: {
    flexDirection: "row",
    marginTop: 24,
    marginBottom: 4,
  },
  sigLabel: { fontSize: 9, color: "#6b7280", marginTop: 2 },
  sigUnderline: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#111",
    height: 14,
  },
});

function money(n: number) {
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(n: number) {
  return `${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })}%`;
}

export type EstimateCustomer = {
  fullName: string;
  email: string | null;
  phone: string | null;
  propertyAddress1: string;
  propertyAddress2: string | null;
  city: string;
  state: string;
  zipCode: string;
};

export type EstimateBrand = {
  companyName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  roofingLicense: string | null;
  gcLicense: string | null;
  logoDataUri: string | null;
  paymentDepositPercent: number;
  paymentProgressPercent: number;
  paymentFinalPercent: number;
};

export type EstimateProposal = {
  existingRoofType: string | null;
  proposedRoofTypeOverride: string | null;
  underlaymentType: string | null;
  permitIncluded: boolean;
  projectDurationText: string | null;
  plywoodSheetsIncluded: number | null;
  additionalPlywoodPrice: number | null;
  workmanshipWarrantyYears: number | null;
  manufacturerWarranty: string | null;
  isEstimateOnly: boolean;
};

export type EstimatePdfData = {
  estimateNumber: string;
  issueDate: Date;
  validityDays: number;
  specialTerms: string | null;
  customer: EstimateCustomer;
  breakdown: EstimateBreakdown;
  brand: EstimateBrand;
  proposal: EstimateProposal;
};

function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function roofTypeLabel(
  breakdown: EstimateBreakdown,
  proposal: EstimateProposal,
): string {
  if (proposal.proposedRoofTypeOverride) return proposal.proposedRoofTypeOverride;
  const names = breakdown.roofTypes.map((rt) => MATERIAL_LABELS[rt.material]);
  return joinList(names) || "(roof type)";
}

function materialSelectionLabel(breakdown: EstimateBreakdown): string {
  if (breakdown.materialSelection) return breakdown.materialSelection;
  return joinList(
    breakdown.roofTypes.map(
      (rt) =>
        `${rt.squares} sq of ${MATERIAL_LABELS[rt.material]} roofing material`,
    ),
  );
}

function brandCityStateZip(brand: EstimateBrand): string {
  return [brand.city, brand.state, brand.zip].filter(Boolean).join(
    brand.state && brand.zip ? " " : ", ",
  );
}

function BrandHeader({
  brand,
  rightSlot,
}: {
  brand: EstimateBrand;
  rightSlot: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.brandBlock}>
        {brand.logoDataUri ? (
          // @react-pdf Image is not an HTML img — alt prop is not a valid prop here
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image style={styles.logo} src={brand.logoDataUri} />
        ) : null}
        <View>
          <Text style={styles.companyName}>{brand.companyName}</Text>
          {brand.addressLine1 ? (
            <Text style={styles.muted}>{brand.addressLine1}</Text>
          ) : null}
          {brand.addressLine2 ? (
            <Text style={styles.muted}>{brand.addressLine2}</Text>
          ) : null}
          {brand.city || brand.state || brand.zip ? (
            <Text style={styles.muted}>{brandCityStateZip(brand)}</Text>
          ) : null}
          {brand.phone ? <Text style={styles.muted}>{brand.phone}</Text> : null}
          {brand.email ? <Text style={styles.muted}>{brand.email}</Text> : null}
          {brand.website ? (
            <Text style={styles.muted}>{brand.website}</Text>
          ) : null}
          {brand.roofingLicense || brand.gcLicense ? (
            <Text style={[styles.tiny, { marginTop: 4 }]}>
              Licensed &amp; Insured
              {brand.roofingLicense
                ? ` · Roofing Lic #${brand.roofingLicense}`
                : ""}
              {brand.gcLicense ? ` · GC Lic #${brand.gcLicense}` : ""}
            </Text>
          ) : null}
        </View>
      </View>
      <View>{rightSlot}</View>
    </View>
  );
}

function ProposalFooter({ brand }: { brand: EstimateBrand }) {
  return (
    <>
      <Text style={styles.footerNote} fixed>
        Credit card payments may be subject to a convenience fee.
      </Text>
      <Text
        style={styles.footer}
        render={({ pageNumber, totalPages }) =>
          `${brand.companyName} · ${brand.phone ?? ""} · ${brand.email ?? ""}    Page ${pageNumber} of ${totalPages}`
        }
        fixed
      />
    </>
  );
}

// ─── Page 1: Header / Title / Prepared For / Project Summary / Investment ──
function ClientPage1({ data }: { data: EstimatePdfData }) {
  const { brand, proposal, breakdown, customer } = data;
  const expiry = new Date(
    data.issueDate.getTime() + data.validityDays * 24 * 60 * 60 * 1000,
  );
  const proposedRoof = roofTypeLabel(breakdown, proposal);
  const total = breakdown.totalPrice;

  const dep = Math.round((total * brand.paymentDepositPercent) / 100 * 100) / 100;
  const prog = Math.round((total * brand.paymentProgressPercent) / 100 * 100) / 100;
  const fin = Math.round((total - dep - prog) * 100) / 100;

  return (
    <Page size="LETTER" style={styles.page}>
      <BrandHeader
        brand={brand}
        rightSlot={
          <View>
            <Text style={styles.docLabel}>
              {proposal.isEstimateOnly ? "ESTIMATE" : "PROPOSAL"}
            </Text>
            <Text style={styles.muted}>No. {data.estimateNumber}</Text>
            <Text style={styles.muted}>
              Issued: {data.issueDate.toLocaleDateString("en-US")}
            </Text>
            <Text style={styles.muted}>
              Valid through: {expiry.toLocaleDateString("en-US")}
            </Text>
          </View>
        }
      />

      {proposal.isEstimateOnly ? (
        <Text style={styles.estimateOnlyBanner}>
          ESTIMATE ONLY — This document is for budgeting purposes and is not a
          binding contract.
        </Text>
      ) : null}

      <Text style={styles.title}>ROOF REPLACEMENT PROPOSAL</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Prepared for</Text>
        <Text style={styles.bold}>{customer.fullName}</Text>
        <Text>{customer.propertyAddress1}</Text>
        {customer.propertyAddress2 ? (
          <Text>{customer.propertyAddress2}</Text>
        ) : null}
        <Text>
          {customer.city}, {customer.state} {customer.zipCode}
        </Text>
        {customer.phone ? (
          <Text style={styles.muted}>{customer.phone}</Text>
        ) : null}
        {customer.email ? (
          <Text style={styles.muted}>{customer.email}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Project summary</Text>
        <SummaryRow label="Existing roof" value={proposal.existingRoofType || "—"} />
        <SummaryRow label="Proposed roof" value={proposedRoof} />
        <SummaryRow
          label="Approximate squares"
          value={`${breakdown.totalSquares} squares`}
        />
        <SummaryRow
          label="Selected material"
          value={materialSelectionLabel(breakdown)}
        />
        <SummaryRow
          label="Underlayment"
          value={proposal.underlaymentType || "Standard synthetic underlayment per code"}
        />
        <SummaryRow
          label="Permit"
          value={proposal.permitIncluded ? "Included (coordination + fees)" : "Not included"}
        />
        {proposal.projectDurationText ? (
          <SummaryRow
            label="Estimated duration"
            value={proposal.projectDurationText}
          />
        ) : null}
        <SummaryRow
          label="Proposal valid through"
          value={expiry.toLocaleDateString("en-US")}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Investment summary</Text>
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total Contract Amount</Text>
          <Text style={styles.totalValue}>{money(total)}</Text>
          {breakdown.discountEnabled && breakdown.discountAmount > 0 ? (
            <Text style={[styles.muted, { marginTop: 4, color: "#065f46" }]}>
              Includes a {pct(breakdown.discountPercent)} discount of{" "}
              {money(breakdown.discountAmount)}.
            </Text>
          ) : null}
        </View>
        <View style={{ marginTop: 6 }}>
          <Text style={styles.bold}>Payment schedule</Text>
          <View style={styles.payRow}>
            <Text>
              {pct(brand.paymentDepositPercent)} Deposit Upon Signing
            </Text>
            <Text style={styles.bold}>{money(dep)}</Text>
          </View>
          <View style={styles.payRow}>
            <Text>
              {pct(brand.paymentProgressPercent)} Due Upon In-Progress Inspection
            </Text>
            <Text style={styles.bold}>{money(prog)}</Text>
          </View>
          <View style={styles.payRow}>
            <Text>
              {pct(brand.paymentFinalPercent)} Due Upon Final Inspection
            </Text>
            <Text style={styles.bold}>{money(fin)}</Text>
          </View>
        </View>
      </View>

      <ProposalFooter brand={brand} />
      <Text style={styles.pageNumber} fixed render={() => ""} />
    </Page>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowLine}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// ─── Page 2: Scope of work + Included items ───────────────────────────────
const SCOPE_STEPS = (proposedRoof: string) => [
  "Remove existing roofing system as required for the approved scope.",
  "Dispose of roofing debris and construction waste.",
  "Inspect exposed roof decking after tear-off.",
  "Install approved underlayment system.",
  `Install selected roofing system: ${proposedRoof}.`,
  "Install flashing, drip edge, vents, pipe boots, ridge/hip components, and related accessories as required by applicable Florida Building Code and manufacturer specifications.",
  "Coordinate required municipal inspections.",
  "Perform reasonable jobsite cleanup upon completion.",
];

const INCLUDED_ITEMS = [
  "Labor",
  "Standard roofing materials",
  "Permit coordination",
  "Standard flashing and roofing accessories",
  "Dumpster / disposal",
  "Standard jobsite cleanup",
  "Municipal inspection coordination",
];

function ClientPage2({ data }: { data: EstimatePdfData }) {
  const { brand, proposal, breakdown } = data;
  const proposedRoof = roofTypeLabel(breakdown, proposal);
  const steps = SCOPE_STEPS(proposedRoof);

  return (
    <Page size="LETTER" style={styles.page}>
      <BrandHeader
        brand={brand}
        rightSlot={
          <View>
            <Text style={styles.muted}>Proposal No. {data.estimateNumber}</Text>
          </View>
        }
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Scope of work</Text>
        <Text style={{ marginBottom: 6 }}>
          Contractor shall furnish labor, supervision, materials, permit
          coordination, and installation services for the roofing work at the
          project address.
        </Text>
        <Text style={[styles.bold, { marginBottom: 4 }]}>
          The scope includes:
        </Text>
        {steps.map((step, i) => (
          <View key={i} style={styles.numberedItem} wrap={false}>
            <Text style={styles.numberCol}>{i + 1}.</Text>
            <Text style={styles.itemBody}>{step}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Included items</Text>
        {INCLUDED_ITEMS.map((it, i) => (
          <Text key={i} style={styles.bullet}>
            • {it}
          </Text>
        ))}
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>Workmanship & material warranty</Text>
        {proposal.workmanshipWarrantyYears != null ? (
          <Text>
            Workmanship warranty:{" "}
            <Text style={styles.bold}>
              {proposal.workmanshipWarrantyYears}-year
            </Text>{" "}
            workmanship warranty on installation, per the executed contract.
          </Text>
        ) : null}
        {proposal.manufacturerWarranty ? (
          <Text style={{ marginTop: 4 }}>
            Manufacturer warranty: {proposal.manufacturerWarranty}
          </Text>
        ) : null}
        <Text style={[styles.muted, { marginTop: 4 }]}>
          Manufacturer warranties are subject to manufacturer terms and
          conditions. Workmanship and manufacturer warranties are issued
          separately.
        </Text>
      </View>

      {data.specialTerms ? (
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Special terms</Text>
          <Text>{data.specialTerms}</Text>
        </View>
      ) : null}

      <ProposalFooter brand={brand} />
    </Page>
  );
}

// ─── Page 3: Allowances + Exclusions ──────────────────────────────────────
const EXCLUSIONS = [
  "Structural repairs",
  "Truss, rafter, fascia, soffit, or framing repairs",
  "Engineering or architectural reports",
  "HOA application fees",
  "Special assessments",
  "Unforeseen code-required upgrades",
  "Electrical, plumbing, HVAC, or solar removal / reinstallation",
  "Interior drywall, paint, or ceiling repairs",
  "Mold remediation",
  "Termite or pest damage repairs",
  "Owner-requested upgrades not listed in the scope",
];

function ClientPage3({ data }: { data: EstimatePdfData }) {
  const { brand, proposal } = data;
  return (
    <Page size="LETTER" style={styles.page}>
      <BrandHeader
        brand={brand}
        rightSlot={
          <View>
            <Text style={styles.muted}>Proposal No. {data.estimateNumber}</Text>
          </View>
        }
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Allowances</Text>
        <Text style={styles.bullet}>
          • Proposal includes up to{" "}
          <Text style={styles.bold}>
            {proposal.plywoodSheetsIncluded ?? 0} sheet
            {(proposal.plywoodSheetsIncluded ?? 0) === 1 ? "" : "s"}
          </Text>{" "}
          of plywood / decking replacement.
        </Text>
        <Text style={styles.bullet}>
          • Additional plywood / decking replacement shall be billed at{" "}
          <Text style={styles.bold}>
            {money(proposal.additionalPlywoodPrice ?? 0)} per sheet
          </Text>{" "}
          unless otherwise stated in writing.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Exclusions (unless specifically stated)
        </Text>
        {EXCLUSIONS.map((it, i) => (
          <Text key={i} style={styles.bullet}>
            • {it}
          </Text>
        ))}
      </View>

      <ProposalFooter brand={brand} />
    </Page>
  );
}

// ─── Page 4: Disclosures + Acceptance ─────────────────────────────────────
const DISCLOSURES: Array<{ title: string; body: string }> = [
  {
    title: "Hidden Conditions",
    body: "Contractor is not responsible for concealed or latent conditions including but not limited to rotten decking, structural deficiencies, termite damage, deteriorated fascia, framing issues, or other conditions discovered after work begins. Such work will require a written change order.",
  },
  {
    title: "Code Upgrades",
    body: "Any work required by the building department, inspector, engineer, or applicable code that is not expressly included in this proposal shall be treated as a change order.",
  },
  {
    title: "Weather and Inspection Delays",
    body: "Contractor is not responsible for delays caused by weather, material shortages, inspection scheduling, municipality delays, HOA approval delays, supplier delays, or events outside Contractor's control.",
  },
  {
    title: "Material Availability",
    body: "Material pricing and availability are subject to supplier availability. This proposal is valid only through the expiration date listed.",
  },
  {
    title: "Color / Product Matching",
    body: "Contractor does not guarantee exact color, texture, dye lot, or batch matching of roofing materials.",
  },
  {
    title: "Owner-Supplied Materials",
    body: "If owner supplies materials, Contractor is not responsible for product defects, shortages, delays, manufacturer warranty issues, compatibility issues, or additional labor caused by owner-supplied materials.",
  },
  {
    title: "Change Orders",
    body: "All scope changes must be approved in writing before additional work proceeds.",
  },
  {
    title: "Property Protection",
    body: "Contractor will take reasonable precautions to protect the property but is not responsible for normal construction impacts to landscaping, irrigation, driveways, fragile exterior items, or personal property not removed from work areas.",
  },
  {
    title: "Payment Default",
    body: "Failure to make timely payment may result in work stoppage, acceleration of the balance due, collection costs, attorney's fees, and reactivation fees.",
  },
  {
    title: "Warranty",
    body: "Workmanship warranty and manufacturer warranty shall be stated separately. Manufacturer warranties are subject to manufacturer terms and conditions.",
  },
];

function ClientPage4({ data }: { data: EstimatePdfData }) {
  const { brand, proposal } = data;
  return (
    <Page size="LETTER" style={styles.page}>
      <BrandHeader
        brand={brand}
        rightSlot={
          <View>
            <Text style={styles.muted}>Proposal No. {data.estimateNumber}</Text>
          </View>
        }
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Disclosures</Text>
        {DISCLOSURES.map((d, i) => (
          <View key={i} style={styles.numberedItem} wrap={false}>
            <Text style={styles.numberCol}>{i + 1}.</Text>
            <View style={styles.itemBody}>
              <Text style={styles.bold}>{d.title}</Text>
              <Text>{d.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {proposal.isEstimateOnly ? (
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Estimate notice</Text>
          <Text>
            This document is an estimate only and is not a binding contract. A
            separate written contract is required prior to commencement of work
            and will govern the engagement, including payment terms, scope of
            work, schedule, and warranty.
          </Text>
        </View>
      ) : (
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Acceptance</Text>
          <Text style={{ marginBottom: 4 }}>
            By signing below, Owner authorizes {brand.companyName} / KNU
            Construction to proceed with the roofing work described in this
            proposal subject to the terms, scope, exclusions, allowances,
            payment schedule, and disclosures contained herein.
          </Text>

          <View style={styles.sigBlock}>
            <View style={styles.sigLine}>
              <View style={[styles.sigUnderline, { marginRight: 16 }]} />
              <View style={[styles.sigUnderline, { maxWidth: 110 }]} />
            </View>
            <View style={{ flexDirection: "row" }}>
              <Text style={[styles.sigLabel, { flex: 1 }]}>Owner signature</Text>
              <Text style={[styles.sigLabel, { width: 126 }]}>Date</Text>
            </View>

            <View style={styles.sigLine}>
              <View style={styles.sigUnderline} />
            </View>
            <Text style={styles.sigLabel}>Owner printed name</Text>

            <View style={styles.sigLine}>
              <View style={[styles.sigUnderline, { marginRight: 16 }]} />
              <View style={[styles.sigUnderline, { maxWidth: 110 }]} />
            </View>
            <View style={{ flexDirection: "row" }}>
              <Text style={[styles.sigLabel, { flex: 1 }]}>
                Contractor representative
              </Text>
              <Text style={[styles.sigLabel, { width: 126 }]}>Date</Text>
            </View>
          </View>
        </View>
      )}

      <ProposalFooter brand={brand} />
    </Page>
  );
}

function ClientEstimateDoc({ data }: { data: EstimatePdfData }) {
  return (
    <Document
      title={`Roofing Proposal ${data.estimateNumber}`}
      author={data.brand.companyName}
    >
      <ClientPage1 data={data} />
      <ClientPage2 data={data} />
      <ClientPage3 data={data} />
      <ClientPage4 data={data} />
    </Document>
  );
}

// ─── Internal PDF (back-office breakdown, brand-aware) ────────────────────
function FeeRow({ label, amount }: { label: string; amount: number }) {
  if (amount <= 0) return null;
  return (
    <View style={styles.lineRow}>
      <Text style={styles.colDesc}>{label}</Text>
      <Text style={styles.colQty}>—</Text>
      <Text style={styles.colRate}>—</Text>
      <Text style={styles.colAmount}>{money(amount)}</Text>
    </View>
  );
}

function InternalEstimateDoc({ data }: { data: EstimatePdfData }) {
  const b = data.breakdown;
  const brand = data.brand;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.watermark}>INTERNAL — NOT FOR CLIENT</Text>
        <BrandHeader
          brand={brand}
          rightSlot={
            <View>
              <Text style={styles.internalLabel}>INTERNAL ESTIMATE</Text>
              <Text style={styles.muted}>No. {data.estimateNumber}</Text>
              <Text style={styles.muted}>
                Issued: {data.issueDate.toLocaleDateString("en-US")}
              </Text>
            </View>
          }
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepared for</Text>
          <Text style={styles.bold}>{data.customer.fullName}</Text>
          <Text style={styles.muted}>
            {data.customer.propertyAddress1}
            {data.customer.propertyAddress2
              ? `, ${data.customer.propertyAddress2}`
              : ""}
            , {data.customer.city}, {data.customer.state}{" "}
            {data.customer.zipCode}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Labor by roof type</Text>
          <View style={styles.lineHeader}>
            <Text style={styles.colDesc}>Material</Text>
            <Text style={styles.colQty}>Squares</Text>
            <Text style={styles.colRate}>$/Square</Text>
            <Text style={styles.colAmount}>Labor</Text>
          </View>
          {b.roofTypes.map((rt, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={styles.colDesc}>{MATERIAL_LABELS[rt.material]}</Text>
              <Text style={styles.colQty}>{rt.squares}</Text>
              <Text style={styles.colRate}>{money(rt.laborRatePerSquare)}</Text>
              <Text style={styles.colAmount}>{money(rt.laborTotal)}</Text>
            </View>
          ))}
          <View style={styles.lineRow}>
            <Text style={[styles.colDesc, styles.bold]}>Labor subtotal</Text>
            <Text style={styles.colQty}>{b.totalSquares}</Text>
            <Text style={styles.colRate} />
            <Text style={[styles.colAmount, styles.bold]}>
              {money(b.laborTotal)}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Materials</Text>
          <View style={styles.lineHeader}>
            <Text style={styles.colDesc}>Item</Text>
            <Text style={styles.colQty} />
            <Text style={styles.colRate} />
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          <View style={styles.lineRow}>
            <Text style={styles.colDesc}>
              Hard material cost
              {b.materialSelection ? ` — ${b.materialSelection}` : ""}
            </Text>
            <Text style={styles.colQty}>—</Text>
            <Text style={styles.colRate}>—</Text>
            <Text style={styles.colAmount}>{money(b.materialCost)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Other fees</Text>
          <View style={styles.lineHeader}>
            <Text style={styles.colDesc}>Item</Text>
            <Text style={styles.colQty} />
            <Text style={styles.colRate} />
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          <FeeRow label="Permit fee" amount={b.permitFee} />
          <FeeRow label="Dumpster fee" amount={b.dumpsterFee} />
          <FeeRow label="Tear-off / disposal" amount={b.tearOffFee} />
          <FeeRow label="Decking replacement" amount={b.deckingFee} />
          <FeeRow label="Underlayment / ice & water" amount={b.underlaymentFee} />
          <FeeRow
            label="Flashing / drip edge / vents"
            amount={b.flashingVentFee}
          />
          <FeeRow
            label="Skylight / chimney work"
            amount={b.skylightChimneyFee}
          />
          <FeeRow label="Gutters / downspouts" amount={b.guttersFee} />
          <FeeRow label={b.miscLabel || "Misc"} amount={b.miscFee} />
          <View style={styles.lineRow}>
            <Text style={[styles.colDesc, styles.bold]}>Other fees subtotal</Text>
            <Text style={styles.colQty} />
            <Text style={styles.colRate} />
            <Text style={[styles.colAmount, styles.bold]}>
              {money(b.otherFeesTotal)}
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          <View style={styles.totalsRow}>
            <Text style={styles.bold}>Subtotal cost (labor + material + fees)</Text>
            <Text style={styles.bold}>{money(b.subtotalCost)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>Margin ({pct(b.marginPercent)})</Text>
            <Text>{money(b.marginAmount)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.bold}>Price with margin</Text>
            <Text style={styles.bold}>{money(b.priceWithMargin)}</Text>
          </View>
          {b.discountEnabled && b.discountAmount > 0 ? (
            <>
              <View style={styles.totalsRow}>
                <Text>Discount ({pct(b.discountPercent)})</Text>
                <Text>-{money(b.discountAmount)}</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.bold}>Price after discount</Text>
                <Text style={styles.bold}>{money(b.priceAfterDiscount)}</Text>
              </View>
            </>
          ) : null}
          {b.salesTaxAmount > 0 ? (
            <View style={styles.totalsRow}>
              <Text>Sales tax ({pct(b.salesTaxPercent)})</Text>
              <Text>{money(b.salesTaxAmount)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.internalTotalBox}>
          <Text style={styles.internalTotalLabel}>Total client price</Text>
          <Text style={styles.internalTotalValue}>{money(b.totalPrice)}</Text>
          <Text style={[styles.muted, { marginTop: 6, color: "#7f1d1d" }]}>
            Cost: {money(b.subtotalCost)} · Gross profit:{" "}
            {money(b.totalPrice - b.subtotalCost - b.salesTaxAmount)} ·
            Effective margin:{" "}
            {b.priceAfterDiscount > 0
              ? pct(
                  ((b.priceAfterDiscount - b.subtotalCost) /
                    b.priceAfterDiscount) *
                    100,
                )
              : "—"}
          </Text>
        </View>

        {data.specialTerms ? (
          <View style={[styles.section, { marginTop: 14 }]}>
            <Text style={styles.sectionTitle}>Special terms (per client)</Text>
            <Text>{data.specialTerms}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          INTERNAL DOCUMENT · Do not distribute outside {brand.companyName}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderClientEstimatePdf(
  data: EstimatePdfData,
): Promise<Buffer> {
  return renderToBuffer(<ClientEstimateDoc data={data} />);
}

export async function renderInternalEstimatePdf(
  data: EstimatePdfData,
): Promise<Buffer> {
  return renderToBuffer(<InternalEstimateDoc data={data} />);
}
