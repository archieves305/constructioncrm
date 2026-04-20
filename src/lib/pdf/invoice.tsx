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

export type InvoiceData = {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  amount: number;
  status: string;
  notes: string | null;
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
            <Text style={styles.invoiceLabel}>INVOICE</Text>
            <Text style={styles.muted}>No. {data.invoiceNumber}</Text>
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

        <View style={styles.lineItemsHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colAmount}>Amount</Text>
        </View>
        <View style={styles.lineItemRow}>
          <Text style={styles.colDesc}>
            {data.job.serviceType} — {data.job.title}
          </Text>
          <Text style={styles.colAmount}>{money(data.job.contractAmount)}</Text>
        </View>
        {data.job.depositReceived > 0 ? (
          <View style={styles.lineItemRow}>
            <Text style={styles.colDesc}>Less: deposit received</Text>
            <Text style={styles.colAmount}>
              -{money(data.job.depositReceived)}
            </Text>
          </View>
        ) : null}

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Amount Due</Text>
          <Text style={styles.totalValue}>{money(data.amount)}</Text>
        </View>

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
