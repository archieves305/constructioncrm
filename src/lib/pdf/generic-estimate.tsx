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
  type GenericEstimateBreakdown,
  UNIT_LABELS,
  CATEGORY_LABELS,
} from "@/lib/estimates/generic-calc";
import type { EstimateBrand } from "@/lib/pdf/brand";

// Mirrors src/lib/pdf/estimate.tsx (roofing) styling so the two estimate PDFs
// look like one product line. Styles are duplicated intentionally to keep the
// roofing renderer untouched and let the two evolve independently.
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
  scopeSectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 10,
    marginBottom: 2,
    color: "#0f766e",
  },
  lineHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 4,
    marginTop: 4,
    fontWeight: 700,
    fontSize: 9,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  lineRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  colDesc: { flex: 3 },
  colQty: { flex: 1.1, textAlign: "right" },
  colRate: { flex: 1.1, textAlign: "right" },
  colAmount: { flex: 1.1, textAlign: "right" },
  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  itemNote: { fontSize: 8.5, color: "#6b7280", marginTop: 1 },
  optionalTag: { fontSize: 8, color: "#92400e" },
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
  bodyText: { marginBottom: 4 },
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
  sigBlock: { marginTop: 18, paddingTop: 10 },
  sigLine: { flexDirection: "row", marginTop: 24, marginBottom: 4 },
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

export type GenericEstimateCustomer = {
  fullName: string;
  email: string | null;
  phone: string | null;
  propertyAddress1: string;
  propertyAddress2: string | null;
  city: string;
  state: string;
  zipCode: string;
};

export type GenericEstimatePdfData = {
  estimateNumber: string;
  issueDate: Date;
  validityDays: number;
  name: string;
  templateCategory: string;
  leadId: string;
  notes: string | null;
  exclusions: string | null;
  customer: GenericEstimateCustomer;
  breakdown: GenericEstimateBreakdown;
  brand: EstimateBrand;
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? "Project";
}

function brandCityStateZip(brand: EstimateBrand): string {
  return [brand.city, brand.state, brand.zip]
    .filter(Boolean)
    .join(brand.state && brand.zip ? " " : ", ");
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
              {brand.gcLicense ? ` · GC Lic #${brand.gcLicense}` : ""}
              {brand.roofingLicense
                ? ` · Roofing Lic #${brand.roofingLicense}`
                : ""}
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowLine}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function PreparedFor({ customer }: { customer: GenericEstimateCustomer }) {
  return (
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
  );
}

function ScopeTable({
  breakdown,
  showAmounts,
}: {
  breakdown: GenericEstimateBreakdown;
  showAmounts: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Scope of work</Text>
      {breakdown.sections.map((section, si) => (
        <View key={si} wrap={false}>
          <Text style={styles.scopeSectionTitle}>{section.title}</Text>
          <View style={styles.lineHeader}>
            <Text style={styles.colDesc}>Description</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colRate}>Unit price</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          {section.items.length === 0 ? (
            <View style={styles.lineRow}>
              <Text style={[styles.colDesc, styles.muted]}>
                (No line items)
              </Text>
              <Text style={styles.colQty} />
              <Text style={styles.colRate} />
              <Text style={styles.colAmount} />
            </View>
          ) : (
            section.items.map((item, ii) => (
              <View key={ii} style={styles.lineRow}>
                <View style={styles.colDesc}>
                  <Text>
                    {item.description}
                    {item.isOptional ? (
                      <Text style={styles.optionalTag}> (optional)</Text>
                    ) : null}
                  </Text>
                  {item.notes ? (
                    <Text style={styles.itemNote}>{item.notes}</Text>
                  ) : null}
                </View>
                <Text style={styles.colQty}>
                  {item.isOptional
                    ? "—"
                    : `${item.quantity} ${UNIT_LABELS[item.unitType]}`}
                </Text>
                <Text style={styles.colRate}>
                  {item.isOptional ? "—" : money(item.unitPrice)}
                </Text>
                <Text style={styles.colAmount}>
                  {item.isOptional
                    ? "—"
                    : showAmounts
                      ? money(item.lineTotal)
                      : "—"}
                </Text>
              </View>
            ))
          )}
          <View style={styles.subtotalRow}>
            <Text style={[styles.colDesc, styles.bold]}>
              {section.title} subtotal
            </Text>
            <Text style={styles.colQty} />
            <Text style={styles.colRate} />
            <Text style={[styles.colAmount, styles.bold]}>
              {showAmounts ? money(section.sectionSubtotal) : "—"}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Client proposal ─────────────────────────────────────────────────────────
function ClientDoc({ data }: { data: GenericEstimatePdfData }) {
  const { brand, breakdown, customer } = data;
  const expiry = new Date(
    data.issueDate.getTime() + data.validityDays * 24 * 60 * 60 * 1000,
  );
  const total = breakdown.totalPrice;
  const dep =
    Math.round(((total * brand.paymentDepositPercent) / 100) * 100) / 100;
  const prog =
    Math.round(((total * brand.paymentProgressPercent) / 100) * 100) / 100;
  const fin = Math.round((total - dep - prog) * 100) / 100;
  const label = categoryLabel(data.templateCategory);

  return (
    <Document
      title={`${label} Proposal ${data.estimateNumber}`}
      author={brand.companyName}
    >
      <Page size="LETTER" style={styles.page}>
        <BrandHeader
          brand={brand}
          rightSlot={
            <View>
              <Text style={styles.docLabel}>PROPOSAL</Text>
              <Text style={styles.muted}>No. {data.estimateNumber}</Text>
              <Text style={styles.muted}>
                Issued: {data.issueDate.toLocaleDateString("en-US")}
              </Text>
              <Text style={styles.muted}>
                Valid through: {expiry.toLocaleDateString("en-US")}
              </Text>
              <Text style={styles.muted}>Lead Ref: {data.leadId}</Text>
            </View>
          }
        />

        <Text style={styles.title}>
          {label.toUpperCase()} PROPOSAL
        </Text>

        <PreparedFor customer={customer} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project</Text>
          <SummaryRow label="Scope" value={data.name} />
          <SummaryRow label="Trade" value={label} />
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
              <Text>{pct(brand.paymentDepositPercent)} Deposit Upon Signing</Text>
              <Text style={styles.bold}>{money(dep)}</Text>
            </View>
            <View style={styles.payRow}>
              <Text>
                {pct(brand.paymentProgressPercent)} Due Upon In-Progress
                Inspection
              </Text>
              <Text style={styles.bold}>{money(prog)}</Text>
            </View>
            <View style={styles.payRow}>
              <Text>
                {pct(brand.paymentFinalPercent)} Due Upon Final Completion
              </Text>
              <Text style={styles.bold}>{money(fin)}</Text>
            </View>
          </View>
        </View>

        <ProposalFooter brand={brand} />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <BrandHeader
          brand={brand}
          rightSlot={
            <View>
              <Text style={styles.muted}>Proposal No. {data.estimateNumber}</Text>
            </View>
          }
        />
        <ScopeTable breakdown={breakdown} showAmounts={true} />

        {data.notes ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        {data.exclusions ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Exclusions</Text>
            <Text>{data.exclusions}</Text>
          </View>
        ) : null}

        <ProposalFooter brand={brand} />
      </Page>

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
          <Text style={styles.sectionTitle}>Acceptance</Text>
          <Text style={styles.bodyText}>
            By signing below, Owner authorizes {brand.companyName} to proceed
            with the {label.toLowerCase()} work described in this proposal,
            subject to the scope, totals, notes, exclusions, and payment schedule
            contained herein. A separate written contract may govern the final
            engagement.
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

        <ProposalFooter brand={brand} />
      </Page>
    </Document>
  );
}

// ─── Internal breakdown ──────────────────────────────────────────────────────
function InternalDoc({ data }: { data: GenericEstimatePdfData }) {
  const b = data.breakdown;
  const brand = data.brand;
  const label = categoryLabel(data.templateCategory);
  return (
    <Document title={`${label} Internal Estimate ${data.estimateNumber}`}>
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
              <Text style={styles.muted}>{label}</Text>
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

        <ScopeTable breakdown={b} showAmounts={true} />

        <View style={{ marginTop: 8 }}>
          <View style={styles.totalsRow}>
            <Text style={styles.bold}>Subtotal cost</Text>
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
            {money(b.totalPrice - b.subtotalCost - b.salesTaxAmount)} · Effective
            margin:{" "}
            {b.priceAfterDiscount > 0
              ? pct(
                  ((b.priceAfterDiscount - b.subtotalCost) /
                    b.priceAfterDiscount) *
                    100,
                )
              : "—"}
          </Text>
        </View>

        {data.notes ? (
          <View style={[styles.section, { marginTop: 14 }]}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          INTERNAL DOCUMENT · Do not distribute outside {brand.companyName}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderGenericClientEstimatePdf(
  data: GenericEstimatePdfData,
): Promise<Buffer> {
  return renderToBuffer(<ClientDoc data={data} />);
}

export async function renderGenericInternalEstimatePdf(
  data: GenericEstimatePdfData,
): Promise<Buffer> {
  return renderToBuffer(<InternalDoc data={data} />);
}
