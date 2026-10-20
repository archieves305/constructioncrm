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
import { COMPANY, CHANGE_ORDER_EMAIL } from "./company";

// The change-order form the customer receives: letterhead, the project, the
// change itself, how it moves the contract, and signature blocks. Rendered for
// staff (Money → Change orders → PDF), for the customer's link and as the
// attachment on the customer email.

const ACCENT = "#b45309";
const RULE = "#d6d3d1";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 64,
    paddingHorizontal: 44,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1c1917",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
  },
  brandRow: { flexDirection: "row", alignItems: "center", maxWidth: 300 },
  logo: { width: 64, height: 64, objectFit: "contain", marginRight: 10 },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  muted: { color: "#78716c", fontSize: 9 },
  docBox: { alignItems: "flex-end" },
  docLabel: { fontSize: 20, fontFamily: "Helvetica-Bold", color: ACCENT, letterSpacing: 1 },
  docMetaRow: { flexDirection: "row", marginTop: 2 },
  docMetaLabel: { color: "#78716c", fontSize: 9, width: 58, textAlign: "right", marginRight: 6 },
  docMetaValue: { fontSize: 9, fontFamily: "Helvetica-Bold", minWidth: 70 },

  statusBand: {
    marginTop: 10,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 3,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  infoGrid: { flexDirection: "row", marginTop: 14 },
  infoCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: RULE,
    padding: 8,
  },
  infoCellLeft: { marginRight: 8 },
  cellTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#78716c",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  strong: { fontFamily: "Helvetica-Bold" },

  sectionTitle: {
    marginTop: 16,
    marginBottom: 4,
    paddingBottom: 3,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  changeTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  // fontSize beside lineHeight: react-pdf otherwise scales the line height from 18pt.
  scope: { marginTop: 4, fontSize: 10, lineHeight: 1.4 },
  scopeEmpty: { marginTop: 4, color: "#a8a29e", fontStyle: "italic" },

  sumRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f4",
  },
  sumRowStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginTop: 2,
    backgroundColor: "#fffbeb",
    paddingHorizontal: 6,
  },
  sumLabel: { flex: 1 },
  sumValue: { width: 120, textAlign: "right" },

  amountBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fffbeb",
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
  },
  amountLabel: { fontSize: 8, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.5 },
  amountValue: { fontSize: 22, fontFamily: "Helvetica-Bold", color: ACCENT, marginTop: 2 },

  terms: { marginTop: 4, fontSize: 8.5, color: "#44403c", lineHeight: 1.45 },

  sigGrid: { flexDirection: "row", marginTop: 26 },
  sigCell: { flex: 1 },
  sigCellLeft: { marginRight: 24 },
  sigParty: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#78716c", textTransform: "uppercase", letterSpacing: 0.5 },
  sigLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#57534e",
    height: 26,
    marginTop: 6,
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  sigCaption: { fontSize: 8, color: "#78716c", marginTop: 2 },
  sigFilled: { fontSize: 9, fontFamily: "Helvetica-Oblique" },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: "#a8a29e",
    borderTopWidth: 1,
    borderTopColor: "#e7e5e4",
    paddingTop: 5,
  },
});

export type ChangeOrderBillData = {
  number: number;
  title: string | null;
  description: string | null;
  customerPrice: number;
  changeDate: Date;
  status: string;
  sentAt?: Date | null;
  decidedAt?: Date | null;
  decisionName?: string | null;
  rejectionReason?: string | null;
  job: {
    jobNumber: string;
    title: string;
    serviceType: string;
    address?: string;
  };
  customer: {
    fullName: string;
    email: string | null;
    address: string;
  };
  /** Fixed-price jobs only: how this change moves the contract sum. */
  contract?: {
    original: number;
    previousChanges: number;
    beforeThis: number;
    revised: number;
  } | null;
  /** Letterhead; COMPANY fills whatever is missing. */
  brand?: {
    companyName: string;
    addressLines: string[];
    phone: string | null;
    email: string | null;
    website: string | null;
    license: string | null;
    logoDataUri: string | null;
  } | null;
};

function money(n: number) {
  const s = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${s}` : `$${s}`;
}

function signedMoney(n: number) {
  return n > 0 ? `+${money(n)}` : money(n);
}

function day(d: Date) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function statusBand(data: ChangeOrderBillData) {
  const by = data.decisionName ? ` by ${data.decisionName}` : "";
  const on = data.decidedAt ? ` on ${day(data.decidedAt)}` : "";
  switch (data.status) {
    case "APPROVED":
      return { text: `APPROVED${by}${on}`, bg: "#dcfce7", fg: "#166534" };
    case "REJECTED":
      return {
        text: `DECLINED${by}${on}${data.rejectionReason ? ` — ${data.rejectionReason}` : ""}`,
        bg: "#fee2e2",
        fg: "#991b1b",
      };
    case "VOID":
      return { text: "VOID — this change order is no longer in effect", bg: "#f5f5f4", fg: "#57534e" };
    default:
      return null;
  }
}

function ChangeOrderBillDoc({ data }: { data: ChangeOrderBillData }) {
  const brand = data.brand;
  const companyName = brand?.companyName || COMPANY.name;
  const addressLines = brand?.addressLines.length ? brand.addressLines : [COMPANY.address];
  const phone = brand?.phone || COMPANY.phone;
  const email = brand?.email || CHANGE_ORDER_EMAIL;
  const band = statusBand(data);
  const coNo = `CO-${data.number}`;
  const approved = data.status === "APPROVED";

  return (
    <Document title={`Change Order ${coNo} — ${data.job.address || data.job.title}`} author={companyName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            {brand?.logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
              <Image src={brand.logoDataUri} style={styles.logo} />
            ) : null}
            <View>
              <Text style={styles.companyName}>{companyName}</Text>
              {addressLines.map((l) => (
                <Text key={l} style={styles.muted}>{l}</Text>
              ))}
              <Text style={styles.muted}>{[phone, email].filter(Boolean).join("  ·  ")}</Text>
              {brand?.website ? <Text style={styles.muted}>{brand.website}</Text> : null}
              {brand?.license ? <Text style={styles.muted}>Lic. {brand.license}</Text> : null}
            </View>
          </View>
          <View style={styles.docBox}>
            <Text style={styles.docLabel}>CHANGE ORDER</Text>
            <View style={styles.docMetaRow}>
              <Text style={styles.docMetaLabel}>No.</Text>
              <Text style={styles.docMetaValue}>{coNo}</Text>
            </View>
            <View style={styles.docMetaRow}>
              <Text style={styles.docMetaLabel}>Date</Text>
              <Text style={styles.docMetaValue}>{day(data.sentAt ?? data.changeDate)}</Text>
            </View>
            <View style={styles.docMetaRow}>
              <Text style={styles.docMetaLabel}>Job</Text>
              <Text style={styles.docMetaValue}>{data.job.jobNumber}</Text>
            </View>
          </View>
        </View>

        {band ? (
          <Text style={[styles.statusBand, { backgroundColor: band.bg, color: band.fg }]}>
            {band.text}
          </Text>
        ) : null}

        <View style={styles.infoGrid}>
          <View style={[styles.infoCell, styles.infoCellLeft]}>
            <Text style={styles.cellTitle}>Owner</Text>
            <Text style={styles.strong}>{data.customer.fullName}</Text>
            {data.customer.address ? <Text>{data.customer.address}</Text> : null}
            {data.customer.email ? <Text style={styles.muted}>{data.customer.email}</Text> : null}
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.cellTitle}>Project</Text>
            <Text style={styles.strong}>{data.job.address || data.job.title}</Text>
            {data.job.address && data.job.title !== data.job.address ? (
              <Text>{data.job.title}</Text>
            ) : null}
            <Text style={styles.muted}>Contractor: {companyName}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Description of change</Text>
        {data.title ? <Text style={styles.changeTitle}>{data.title}</Text> : null}
        {data.description ? (
          <Text style={styles.scope}>{data.description}</Text>
        ) : !data.title ? (
          <Text style={styles.scopeEmpty}>No description entered.</Text>
        ) : null}

        <View style={styles.amountBox} wrap={false}>
          <Text style={styles.amountLabel}>
            {data.customerPrice < 0 ? "Credit to the contract" : "Amount of this change order"}
          </Text>
          <Text style={styles.amountValue}>{money(data.customerPrice)}</Text>
        </View>

        {data.contract ? (
          <View wrap={false}>
            <Text style={styles.sectionTitle}>Contract sum</Text>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Original contract sum</Text>
              <Text style={styles.sumValue}>{money(data.contract.original)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Net change by previously approved change orders</Text>
              <Text style={styles.sumValue}>{signedMoney(data.contract.previousChanges)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Contract sum prior to this change order</Text>
              <Text style={styles.sumValue}>{money(data.contract.beforeThis)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>This change order ({coNo})</Text>
              <Text style={styles.sumValue}>{signedMoney(data.customerPrice)}</Text>
            </View>
            <View style={styles.sumRowStrong}>
              <Text style={[styles.sumLabel, styles.strong]}>
                {approved ? "Revised contract sum" : "Revised contract sum, once approved"}
              </Text>
              <Text style={[styles.sumValue, styles.strong]}>{money(data.contract.revised)}</Text>
            </View>
          </View>
        ) : null}

        <View wrap={false}>
          <Text style={styles.sectionTitle}>Terms</Text>
          <Text style={styles.terms}>
            This change order amends the agreement between the Owner and {companyName} for the
            project above. Once signed by both parties, the Contractor is authorized to perform the
            work described and the contract sum is adjusted by the amount shown. The amount is due
            as billed. All other terms and conditions of the original agreement remain in full
            force and effect.
          </Text>

          <View style={styles.sigGrid}>
            <View style={[styles.sigCell, styles.sigCellLeft]}>
              <Text style={styles.sigParty}>Owner</Text>
              <View style={styles.sigLine}>
                {approved && data.decisionName ? (
                  <Text style={styles.sigFilled}>
                    Approved electronically: {data.decisionName}
                    {data.decidedAt ? `, ${day(data.decidedAt)}` : ""}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.sigCaption}>Signature</Text>
              <View style={styles.sigLine} />
              <Text style={styles.sigCaption}>Printed name and date</Text>
            </View>
            <View style={styles.sigCell}>
              <Text style={styles.sigParty}>Contractor — {companyName}</Text>
              <View style={styles.sigLine} />
              <Text style={styles.sigCaption}>Signature</Text>
              <View style={styles.sigLine} />
              <Text style={styles.sigCaption}>Printed name and date</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {companyName} · Change Order {coNo} · {data.job.jobNumber}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderChangeOrderBillPdf(
  data: ChangeOrderBillData,
): Promise<Buffer> {
  return renderToBuffer(<ChangeOrderBillDoc data={data} />);
}
