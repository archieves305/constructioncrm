import React from "react";
import {
  Document,
  Image,
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
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  photoCell: { width: "31%" },
  photoImg: { width: "100%", height: 150, objectFit: "cover", borderRadius: 3 },
  photoCaption: { fontSize: 8, color: "#374151", marginTop: 2 },
  signatureBlock: {
    marginTop: 18,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 16,
  },
  signatureImg: { width: 160, height: 50, objectFit: "contain" },
  coverPage: { padding: 60, fontFamily: "Helvetica", color: "#111" },
  coverTitle: { fontSize: 24, fontWeight: 700, marginBottom: 6 },
  coverSub: { fontSize: 12, color: "#6b7280", marginBottom: 24 },
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
  photos: { dataUri: string; caption: string | null; label: string }[];
  photosOmitted: number;
  safetyChecklist: { label: string; done: boolean }[];
  signatureDataUri: string | null;
  signedByName: string | null;
  signedAt: string | null;
  showCost: boolean;
  generatedAt: string;
};

function DailyLogPage({ data }: { data: DailyLogPdfData }) {
  const present = data.entries.filter((e) => !e.isAbsent);
  const absent = data.entries.filter((e) => e.isAbsent);
  return (
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

        {data.safetyChecklist.length > 0 ? (
          <View wrap={false}>
            <Text style={styles.sectionTitle}>Safety Checklist</Text>
            {data.safetyChecklist.map((item) => (
              <Text key={item.label} style={styles.body}>
                {item.done ? "[x]" : "[ ]"} {item.label}
              </Text>
            ))}
          </View>
        ) : null}

        {data.signatureDataUri || data.signedByName ? (
          <View style={styles.signatureBlock} wrap={false}>
            {data.signatureDataUri ? (
              <Image style={styles.signatureImg} src={data.signatureDataUri} />
            ) : null}
            <View>
              <Text style={{ fontWeight: 700 }}>{data.signedByName ?? ""}</Text>
              <Text style={styles.muted}>
                Crew lead signature{data.signedAt ? ` · ${data.signedAt}` : ""}
              </Text>
            </View>
          </View>
        ) : null}

        {data.photos.length > 0 ? (
          <View break>
            <Text style={styles.sectionTitle}>Photos ({data.photos.length})</Text>
            <View style={styles.photoGrid}>
              {data.photos.map((photo, i) => (
                <View key={i} style={styles.photoCell} wrap={false}>
                  <Image style={styles.photoImg} src={photo.dataUri} />
                  <Text style={styles.photoCaption}>
                    {[photo.label, photo.caption].filter(Boolean).join(" — ")}
                  </Text>
                </View>
              ))}
            </View>
            {data.photosOmitted > 0 ? (
              <Text style={[styles.muted, { marginTop: 6 }]}>
                +{data.photosOmitted} more in the job photo gallery
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {COMPANY.name} — Daily Report · Generated {data.generatedAt}
        </Text>
      </Page>
  );
}

export async function renderDailyLogPdf(data: DailyLogPdfData): Promise<Buffer> {
  return renderToBuffer(
    <Document>
      <DailyLogPage data={data} />
    </Document>,
  );
}

export type PackageCover = {
  jobNumber: string;
  jobTitle: string;
  jobAddress: string | null;
  rangeLabel: string;
  dayCount: number;
  totalHours: number;
  totalOtHours: number;
  totalCost?: number;
  generatedAt: string;
};

// Multi-day "hotel package": cover page + each day's full report in one
// document. Callers cap the range (≤14 days) and per-day photos.
export async function renderDailyLogPackagePdf(
  cover: PackageCover,
  days: DailyLogPdfData[],
): Promise<Buffer> {
  return renderToBuffer(
    <Document>
      <Page size="LETTER" style={styles.coverPage}>
        <Text style={styles.coverTitle}>Daily Report Package</Text>
        <Text style={styles.coverSub}>
          {cover.jobNumber} — {cover.jobTitle}
          {cover.jobAddress ? `\n${cover.jobAddress}` : ""}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Period</Text>
            <Text style={styles.metaValue}>{cover.rangeLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Reports</Text>
            <Text style={styles.metaValue}>{cover.dayCount} days</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Labor</Text>
            <Text style={styles.metaValue}>
              {cover.totalHours} hrs
              {cover.totalOtHours > 0 ? ` (${cover.totalOtHours} OT)` : ""}
              {cover.totalCost != null ? ` · $${cover.totalCost.toLocaleString()}` : ""}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 24 }}>
          {days.map((d) => (
            <View key={d.date} style={styles.tr}>
              <Text style={{ flex: 2 }}>{d.date}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>
                {d.totals.workers} workers
              </Text>
              <Text style={{ flex: 1, textAlign: "right" }}>
                {d.totals.regularHours + d.totals.otHours} hrs
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.footer} fixed>
          {COMPANY.name} · Generated {cover.generatedAt}
        </Text>
      </Page>
      {days.map((d) => (
        <DailyLogPage key={d.date} data={d} />
      ))}
    </Document>,
  );
}
