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
  receiptLabel: { fontSize: 18, fontWeight: 700, color: "#2563eb" },
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
  amountBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#eff6ff",
    borderRadius: 4,
  },
  amountLabel: { fontSize: 10, color: "#1e3a8a", textTransform: "uppercase" },
  amountValue: { fontSize: 28, fontWeight: 700, color: "#1e40af", marginTop: 4 },
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

export type ReceiptData = {
  receiptNumber: string;
  paidDate: Date;
  amount: number;
  paymentType: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  job: {
    jobNumber: string;
    title: string;
    contractAmount: number;
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

function ReceiptDoc({ data }: { data: ReceiptData }) {
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
            <Text style={styles.receiptLabel}>PAYMENT RECEIPT</Text>
            <Text style={styles.muted}>No. {data.receiptNumber}</Text>
            <Text style={styles.muted}>
              Date: {data.paidDate.toLocaleDateString("en-US")}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Received from</Text>
          <Text style={styles.value}>{data.customer.fullName}</Text>
          <Text style={styles.muted}>{data.customer.address}</Text>
          {data.customer.email ? (
            <Text style={styles.muted}>{data.customer.email}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>For job</Text>
          <Text style={styles.value}>
            {data.job.jobNumber} — {data.job.title}
          </Text>
        </View>

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Amount Received</Text>
          <Text style={styles.amountValue}>{money(data.amount)}</Text>
        </View>

        <View style={[styles.section, { marginTop: 16 }]}>
          <View style={styles.row}>
            <Text style={styles.label}>Payment type</Text>
            <Text style={styles.value}>{data.paymentType.replace(/_/g, " ")}</Text>
          </View>
          {data.method ? (
            <View style={styles.row}>
              <Text style={styles.label}>Method</Text>
              <Text style={styles.value}>{data.method}</Text>
            </View>
          ) : null}
          {data.reference ? (
            <View style={styles.row}>
              <Text style={styles.label}>Reference / Check #</Text>
              <Text style={styles.value}>{data.reference}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Job Balance</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Contract total</Text>
            <Text>{money(data.job.contractAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Balance remaining</Text>
            <Text style={styles.value}>{money(data.job.balanceDue)}</Text>
          </View>
        </View>

        {data.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          Thank you for your business — {COMPANY.name}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDoc data={data} />);
}
