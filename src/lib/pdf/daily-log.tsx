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
    padding: 42,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  companyName: { fontSize: 15, fontWeight: 700 },
  muted: { color: "#6b7280", fontSize: 9 },
  title: { fontSize: 16, fontWeight: 700, color: "#0f766e" },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginBottom: 14,
  },
  metaItem: { minWidth: 110 },
  metaLabel: { color: "#6b7280", fontSize: 8, textTransform: "uppercase" },
  metaValue: { fontSize: 10, fontWeight: 700 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 12,
    marginBottom: 4,
    color: "#0f766e",
  },
  body: { lineHeight: 1.4 },
  table: { marginTop: 4 },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 3,
  },
  th: { fontWeight: 700, color: "#374151", fontSize: 8, textTransform: "uppercase" },
  name: { flex: 2.2 },
  trade: { flex: 1.4 },
  time: { flex: 1 },
  num: { flex: 0.8, textAlign: "right" },
  flags: { flex: 1.6, fontSize: 8, color: "#6b7280" },
  totalsRow: { flexDirection: "row", paddingTop: 5 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 42,
    right: 42,
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 8,
  },
});

export type DailyLogPdfEntry = {
  name: string;
  trade: string | null;
  isAbsent: boolean;
  isLate: boolean;
  leftEarly: boolean;
  start: string;
  end: string;
  breakMinutes: number;
  regularHours: number;
  otHours: number;
  rate?: number;
  cost?: number;
  notes: string | null;
};

export type DailyLogPdfData = {
  jobNumber: string;
  jobTitle: string;
  jobAddress: string | null;
  date: string; // display-formatted
  status: string;
  managerName: string | null;
  weather: string | null;
  entries: DailyLogPdfEntry[];
  totals: { workers: number; regularHours: number; otHours: number; cost?: number };
  sections: { label: string; text: string }[];
  showCost: boolean;
  generatedAt: string;
};

function DailyLogDoc({ data }: { data: DailyLogPdfData }) {
  const present = data.entries.filter((e) => !e.isAbsent);
  const absent = data.entries.filter((e) => e.isAbsent);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{COMPANY.name}</Text>
            <Text style={styles.muted}>{COMPANY.address}</Text>
            <Text style={styles.muted}>
              {COMPANY.phone} · {COMPANY.email}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>DAILY REPORT</Text>
            <Text style={{ fontSize: 11, fontWeight: 700 }}>{data.date}</Text>
            <Text style={styles.muted}>{data.status}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Job</Text>
            <Text style={styles.metaValue}>
              {data.jobNumber} — {data.jobTitle}
            </Text>
            {data.jobAddress ? (
              <Text style={styles.muted}>{data.jobAddress}</Text>
            ) : null}
          </View>
          {data.managerName ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Crew Lead</Text>
              <Text style={styles.metaValue}>{data.managerName}</Text>
            </View>
          ) : null}
          {data.weather ? (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Weather</Text>
              <Text style={styles.metaValue}>{data.weather}</Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Manpower</Text>
            <Text style={styles.metaValue}>
              {data.totals.workers} workers · {data.totals.regularHours} reg
              {data.totals.otHours > 0 ? ` + ${data.totals.otHours} OT` : ""} hrs
              {data.showCost && data.totals.cost != null
                ? ` · $${data.totals.cost.toLocaleString()}`
                : ""}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Crew</Text>
        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.name, styles.th]}>Worker</Text>
            <Text style={[styles.trade, styles.th]}>Trade</Text>
            <Text style={[styles.time, styles.th]}>In</Text>
            <Text style={[styles.time, styles.th]}>Out</Text>
            <Text style={[styles.num, styles.th]}>Reg</Text>
            <Text style={[styles.num, styles.th]}>OT</Text>
            {data.showCost ? <Text style={[styles.num, styles.th]}>Cost</Text> : null}
            <Text style={[styles.flags, styles.th]}>Notes</Text>
          </View>
          {present.map((e, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={styles.name}>{e.name}</Text>
              <Text style={styles.trade}>{e.trade ?? ""}</Text>
              <Text style={styles.time}>{e.start}</Text>
              <Text style={styles.time}>{e.end}</Text>
              <Text style={styles.num}>{e.regularHours}</Text>
              <Text style={styles.num}>{e.otHours > 0 ? e.otHours : ""}</Text>
              {data.showCost ? (
                <Text style={styles.num}>
                  {e.cost != null ? `$${e.cost.toLocaleString()}` : ""}
                </Text>
              ) : null}
              <Text style={styles.flags}>
                {[
                  e.isLate ? "Late" : null,
                  e.leftEarly ? "Left early" : null,
                  e.notes,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          ))}
          {absent.length > 0 ? (
            <Text style={[styles.muted, { marginTop: 4 }]}>
              Absent: {absent.map((e) => e.name).join(", ")}
            </Text>
          ) : null}
        </View>

        {data.sections.map((s) => (
          <View key={s.label} wrap={false}>
            <Text style={styles.sectionTitle}>{s.label}</Text>
            <Text style={styles.body}>{s.text}</Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          {COMPANY.name} — Daily Report · Generated {data.generatedAt}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderDailyLogPdf(data: DailyLogPdfData): Promise<Buffer> {
  return renderToBuffer(<DailyLogDoc data={data} />);
}
