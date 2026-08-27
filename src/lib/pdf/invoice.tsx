import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { COMPANY } from "./company";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  companyName: { fontSize: 16, fontWeight: 700 },
  invoiceLabel: { fontSize: 18, fontWeight: 700, color: "#0f766e" },
  muted: { color: "#6b7280", fontSize: 10 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: 4,
    color: "#6b7280",
  },
  paragraph: { marginTop: 2, lineHeight: 1.4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  label: { color: "#6b7280" },
  value: { fontWeight: 700 },
  lineItemsHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 4,
    marginTop: 10,
    fontWeight: 700,
    fontSize: 10,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  lineItemRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  colDesc: { flex: 3 },
  colAmount: { flex: 1, textAlign: "right" },
  totalBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#ecfdf5",
    borderRadius: 4,
  },
  totalLabel: { fontSize: 10, color: "#065f46", textTransform: "uppercase" },
  totalValue: { fontSize: 28, fontWeight: 700, color: "#047857", marginTop: 4 },
  g702Row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  g702Label: { flex: 3 },
  g702Value: { flex: 1, textAlign: "right" },
  g703Header: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 4,
    marginTop: 10,
    fontWeight: 700,
    fontSize: 8,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  g703Row: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    fontSize: 9,
  },
  g703Total: {
    flexDirection: "row",
    paddingVertical: 5,
    fontSize: 9,
    fontWeight: 700,
  },
  cItem: { width: 24 },
  cDesc: { flex: 3 },
  cNum: { flex: 1.3, textAlign: "right" },
  cPct: { width: 34, textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
});

export type ApplicationPdfData = {
  applicationNumber: number;
  periodFrom: Date | null;
  periodTo: Date | null;
  contractSum: number;
  completedPrevious: number;
  completedThisPeriod: number;
  completedToDate: number;
  retainagePercent: number;
  retainage: number;
  earnedLessRetainage: number;
  previousCertificates: number;
  currentDue: number;
  balanceToFinish: number;
  lines: {
    itemNo: number;
    description: string;
    scheduledValue: number;
    previous: number;
    thisPeriod: number;
    toDate: number;
    percent: number;
    balanceToFinish: number;
  }[];
};

export type InvoiceData = {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  amount: number;
  status: string;
  notes: string | null;
  // When the invoice was raised from an approved change order, carry its scope
  // so the detailed description is visible on the invoice.
  changeOrder?: {
    number: number;
    title: string | null;
    description: string | null;
  } | null;
  // Progress billing: a numbered payment application with its schedule of
  // values, laid out the way a G702/G703 reads.
  application?: ApplicationPdfData | null;
  job: {
    jobNumber: string;
    title: string;
    serviceType: string;
    contractAmount: number;
    depositReceived: number;
    balanceDue: number;
  };
  customer: {
    fullName: string;
    email: string | null;
    address: string;
  };
};

function money(n: number) {
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Period dates are stored as calendar dates (UTC midnight); format them in UTC
// or an evening render in Florida prints the day before.
function utcDate(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: "UTC" });
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** G702 summary block followed by the G703 continuation table. */
function ApplicationBody({ app }: { app: ApplicationPdfData }) {
  const rows: [string, string][] = [
    ["1. Contract sum to date", money(app.contractSum)],
    ["2. Total completed & stored to date", money(app.completedToDate)],
    [`3. Retainage (${app.retainagePercent}% of completed work)`, money(app.retainage)],
    ["4. Total earned less retainage", money(app.earnedLessRetainage)],
    ["5. Less previous certificates for payment", money(app.previousCertificates)],
    ["6. Current payment due", money(app.currentDue)],
    ["7. Balance to finish, including retainage", money(app.balanceToFinish)],
  ];
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Application for payment</Text>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.g702Row}>
            <Text style={[styles.g702Label, label.startsWith("6.") ? styles.value : {}]}>
              {label}
            </Text>
            <Text style={[styles.g702Value, label.startsWith("6.") ? styles.value : {}]}>
              {value}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Continuation sheet — schedule of values</Text>
      <View style={styles.g703Header}>
        <Text style={styles.cItem}>#</Text>
        <Text style={styles.cDesc}>Description of work</Text>
        <Text style={styles.cNum}>Scheduled value</Text>
        <Text style={styles.cNum}>Previous</Text>
        <Text style={styles.cNum}>This period</Text>
        <Text style={styles.cNum}>To date</Text>
        <Text style={styles.cPct}>%</Text>
        <Text style={styles.cNum}>Balance</Text>
      </View>
      {app.lines.map((l) => (
        <View key={l.itemNo} style={styles.g703Row}>
          <Text style={styles.cItem}>{l.itemNo}</Text>
          <Text style={styles.cDesc}>{l.description}</Text>
          <Text style={styles.cNum}>{money(l.scheduledValue)}</Text>
          <Text style={styles.cNum}>{money(l.previous)}</Text>
          <Text style={styles.cNum}>{money(l.thisPeriod)}</Text>
          <Text style={styles.cNum}>{money(l.toDate)}</Text>
          <Text style={styles.cPct}>{pct(l.percent)}</Text>
          <Text style={styles.cNum}>{money(l.balanceToFinish)}</Text>
        </View>
      ))}
      <View style={styles.g703Total}>
        <Text style={styles.cItem} />
        <Text style={styles.cDesc}>Total</Text>
        <Text style={styles.cNum}>{money(app.lines.reduce((s, l) => s + l.scheduledValue, 0))}</Text>
        <Text style={styles.cNum}>{money(app.completedPrevious)}</Text>
        <Text style={styles.cNum}>{money(app.completedThisPeriod)}</Text>
        <Text style={styles.cNum}>{money(app.completedToDate)}</Text>
        <Text style={styles.cPct}>
          {pct(app.contractSum > 0 ? app.completedToDate / app.contractSum : 0)}
        </Text>
        <Text style={styles.cNum}>{money(app.balanceToFinish)}</Text>
      </View>
    </>
  );
}

function InvoiceDoc({ data }: { data: InvoiceData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{COMPANY.name}</Text>
            {COMPANY.address ? <Text style={styles.muted}>{COMPANY.address}</Text> : null}
            {COMPANY.phone ? <Text style={styles.muted}>{COMPANY.phone}</Text> : null}
            {COMPANY.email ? <Text style={styles.muted}>{COMPANY.email}</Text> : null}
          </View>
          <View>
            <Text style={styles.invoiceLabel}>
              {data.application
                ? `PAYMENT APPLICATION #${data.application.applicationNumber}`
                : "INVOICE"}
            </Text>
            <Text style={styles.muted}>No. {data.invoiceNumber}</Text>
            {data.application?.periodTo ? (
              <Text style={styles.muted}>
                Period:{" "}
                {data.application.periodFrom
                  ? `${utcDate(data.application.periodFrom)} – `
                  : "to "}
                {utcDate(data.application.periodTo)}
              </Text>
            ) : null}
            <Text style={styles.muted}>
              Issued: {data.issueDate.toLocaleDateString("en-US")}
            </Text>
            {data.dueDate ? (
              <Text style={styles.muted}>
                Due: {data.dueDate.toLocaleDateString("en-US")}
              </Text>
            ) : null}
            <Text style={styles.muted}>Status: {data.status}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill to</Text>
          <Text style={styles.value}>{data.customer.fullName}</Text>
          <Text style={styles.muted}>{data.customer.address}</Text>
          {data.customer.email ? (
            <Text style={styles.muted}>{data.customer.email}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project</Text>
          <Text style={styles.value}>
            {data.job.jobNumber} — {data.job.title}
          </Text>
          <Text style={styles.muted}>Service: {data.job.serviceType}</Text>
        </View>

        {data.application ? (
          <ApplicationBody app={data.application} />
        ) : (
          <>
        <View style={styles.lineItemsHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colAmount}>Amount</Text>
        </View>
        {data.changeOrder ? (
          <View style={styles.lineItemRow}>
            <Text style={styles.colDesc}>
              Change Order CO-{data.changeOrder.number}
              {data.changeOrder.title ? ` — ${data.changeOrder.title}` : ""}
            </Text>
            <Text style={styles.colAmount}>{money(data.amount)}</Text>
          </View>
        ) : (
          <>
            <View style={styles.lineItemRow}>
              <Text style={styles.colDesc}>
                {data.job.serviceType} — {data.job.title}
              </Text>
              <Text style={styles.colAmount}>
                {money(data.job.contractAmount)}
              </Text>
            </View>
            {data.job.depositReceived > 0 ? (
              <View style={styles.lineItemRow}>
                <Text style={styles.colDesc}>Less: deposit received</Text>
                <Text style={styles.colAmount}>
                  -{money(data.job.depositReceived)}
                </Text>
              </View>
            ) : null}
          </>
        )}
          </>
        )}

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>
            {data.application ? "Current Payment Due" : "Amount Due"}
          </Text>
          <Text style={styles.totalValue}>{money(data.amount)}</Text>
        </View>

        {data.changeOrder?.description ? (
          <View style={[styles.section, { marginTop: 16 }]}>
            <Text style={styles.sectionTitle}>Scope of change</Text>
            <Text style={styles.paragraph}>{data.changeOrder.description}</Text>
          </View>
        ) : null}

        {data.notes ? (
          <View style={[styles.section, { marginTop: 16 }]}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          Please make checks payable to {COMPANY.name}. Thank you!
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc data={data} />);
}
