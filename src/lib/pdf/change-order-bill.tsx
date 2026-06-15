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
  docLabel: { fontSize: 18, fontWeight: 700, color: "#b45309" },
  muted: { color: "#6b7280", fontSize: 10 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: 4,
    color: "#6b7280",
  },
  value: { fontWeight: 700 },
  paragraph: { marginTop: 2, lineHeight: 1.4 },
  totalBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#fffbeb",
    borderRadius: 4,
  },
  totalLabel: { fontSize: 10, color: "#92400e", textTransform: "uppercase" },
  totalValue: { fontSize: 28, fontWeight: 700, color: "#b45309", marginTop: 4 },
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

export type ChangeOrderBillData = {
  number: number;
  title: string | null;
  description: string | null;
  customerPrice: number;
  changeDate: Date;
  status: string;
  job: {
    jobNumber: string;
    title: string;
    serviceType: string;
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

function ChangeOrderBillDoc({ data }: { data: ChangeOrderBillData }) {
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
            <Text style={styles.docLabel}>CHANGE ORDER</Text>
            <Text style={styles.muted}>No. {data.number}</Text>
            <Text style={styles.muted}>
              Date: {data.changeDate.toLocaleDateString("en-US")}
            </Text>
            <Text style={styles.muted}>Status: {data.status}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepared for</Text>
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

        {data.title ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Change</Text>
            <Text style={styles.value}>{data.title}</Text>
          </View>
        ) : null}

        {data.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scope of change</Text>
            <Text style={styles.paragraph}>{data.description}</Text>
          </View>
        ) : null}

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Additional Amount</Text>
          <Text style={styles.totalValue}>{money(data.customerPrice)}</Text>
        </View>

        <Text style={styles.footer}>
          This change order adjusts the contract for the project above. Your
          approval authorizes {COMPANY.name} to proceed with the additional work
          and adds this amount to your balance due.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderChangeOrderBillPdf(
  data: ChangeOrderBillData,
): Promise<Buffer> {
  return renderToBuffer(<ChangeOrderBillDoc data={data} />);
}
