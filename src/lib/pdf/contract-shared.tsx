import React from "react";
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import type {
  ContractCompany,
  ContractParty,
  ContractAddress,
} from "@/lib/contracts/types";

export const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 64,
    paddingHorizontal: 54,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: "#111",
    lineHeight: 1.45,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#0f766e",
  },
  companyName: { fontSize: 15, fontWeight: 700, color: "#0f766e" },
  muted: { color: "#6b7280", fontSize: 9 },
  docLabel: { fontSize: 13, fontWeight: 700, textAlign: "right" },
  docMeta: { fontSize: 9, color: "#6b7280", textAlign: "right" },
  title: {
    fontSize: 16,
    fontWeight: 700,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9.5,
    textAlign: "center",
    color: "#6b7280",
    marginBottom: 12,
  },
  intro: { marginBottom: 12 },
  article: { marginBottom: 9 },
  articleHeading: {
    fontSize: 10.5,
    fontWeight: 700,
    color: "#0f766e",
    marginBottom: 3,
  },
  body: { marginBottom: 2 },
  bold: { fontWeight: 700 },
  bullet: { marginLeft: 12, marginBottom: 2 },
  rowLine: { flexDirection: "row", marginBottom: 2 },
  rowLabel: { width: 150, color: "#6b7280" },
  rowValue: { flex: 1 },
  partyGrid: { flexDirection: "row", gap: 18, marginBottom: 4 },
  partyCol: { flex: 1 },
  partyHeading: {
    fontSize: 9,
    textTransform: "uppercase",
    color: "#6b7280",
    marginBottom: 2,
  },
  scopeBox: {
    marginTop: 4,
    padding: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 3,
  },
  sigRow: { flexDirection: "row", gap: 28, marginTop: 16 },
  sigCol: { flex: 1 },
  sigLineBox: {
    borderBottomWidth: 1,
    borderBottomColor: "#111",
    height: 22,
    marginBottom: 2,
  },
  sigLabel: { fontSize: 8.5, color: "#6b7280" },
  footerDisclaimer: {
    position: "absolute",
    bottom: 38,
    left: 54,
    right: 54,
    textAlign: "center",
    fontSize: 8,
    fontStyle: "italic",
    color: "#9ca3af",
  },
  footerLine: {
    position: "absolute",
    bottom: 24,
    left: 54,
    right: 54,
    textAlign: "center",
    fontSize: 7.5,
    color: "#9ca3af",
  },
});

export function money(n: number): string {
  return `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "_______________";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "_______________";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function addressOneLine(a: ContractAddress): string {
  const l2 = a.line2 ? `, ${a.line2}` : "";
  return `${a.line1}${l2}, ${a.city}, ${a.state} ${a.zip}`;
}

export function DocHeader({
  company,
  docLabel,
  metaLines,
}: {
  company: ContractCompany;
  docLabel: string;
  metaLines: string[];
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.companyName}>{company.name}</Text>
        <Text style={styles.muted}>{company.address}</Text>
        <Text style={styles.muted}>
          {company.phone}
          {company.email ? ` · ${company.email}` : ""}
        </Text>
      </View>
      <View>
        <Text style={styles.docLabel}>{docLabel}</Text>
        {metaLines.map((m, i) => (
          <Text key={i} style={styles.docMeta}>
            {m}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function Article({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.article} wrap={false}>
      <Text style={styles.articleHeading}>
        {n}. {title}
      </Text>
      {children}
    </View>
  );
}

export function PartyColumn({
  heading,
  party,
  address,
}: {
  heading: string;
  party: ContractParty;
  address?: ContractAddress | null;
}) {
  return (
    <View style={styles.partyCol}>
      <Text style={styles.partyHeading}>{heading}</Text>
      <Text style={styles.bold}>{party.name}</Text>
      {party.companyName ? <Text>{party.companyName}</Text> : null}
      {address ? (
        <>
          <Text>{address.line1}</Text>
          {address.line2 ? <Text>{address.line2}</Text> : null}
          <Text>
            {address.city}, {address.state} {address.zip}
          </Text>
        </>
      ) : null}
      {party.phone ? <Text style={styles.muted}>{party.phone}</Text> : null}
      {party.altPhone ? (
        <Text style={styles.muted}>{party.altPhone}</Text>
      ) : null}
      {party.email ? <Text style={styles.muted}>{party.email}</Text> : null}
      {party.license ? (
        <Text style={styles.muted}>License #{party.license}</Text>
      ) : null}
    </View>
  );
}

export function SignatureBlock({
  ownerName,
  contractorName,
}: {
  ownerName: string;
  contractorName: string;
}) {
  return (
    <View style={styles.sigRow} wrap={false}>
      <View style={styles.sigCol}>
        <View style={styles.sigLineBox} />
        <Text style={styles.sigLabel}>Owner signature</Text>
        <View style={[styles.sigLineBox, { marginTop: 14 }]} />
        <Text style={styles.sigLabel}>
          Printed name{ownerName ? `: ${ownerName}` : ""}
        </Text>
        <View style={[styles.sigLineBox, { marginTop: 14 }]} />
        <Text style={styles.sigLabel}>Date</Text>
      </View>
      <View style={styles.sigCol}>
        <View style={styles.sigLineBox} />
        <Text style={styles.sigLabel}>Labor Contractor signature</Text>
        <View style={[styles.sigLineBox, { marginTop: 14 }]} />
        <Text style={styles.sigLabel}>
          Printed name{contractorName ? `: ${contractorName}` : ""}
        </Text>
        <View style={[styles.sigLineBox, { marginTop: 14 }]} />
        <Text style={styles.sigLabel}>Date</Text>
      </View>
    </View>
  );
}

export function ContractFooter({
  company,
  rightMeta,
}: {
  company: ContractCompany;
  rightMeta: string;
}) {
  return (
    <>
      <Text style={styles.footerDisclaimer} fixed>
        Generated by ConstructionCRM. Review by counsel is recommended before
        execution.
      </Text>
      <Text
        style={styles.footerLine}
        fixed
        render={({ pageNumber, totalPages }) =>
          `${company.name} · ${rightMeta} · Page ${pageNumber} of ${totalPages}`
        }
      />
    </>
  );
}
