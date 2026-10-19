import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY } from "./company";

/** The readiness report of one preflight run, for the permit's file. */
const styles = StyleSheet.create({
  page: { padding: 44, paddingBottom: 60, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  title: { fontSize: 13, fontWeight: 700, color: "#1e3a5f" },
  muted: { color: "#6b7280", fontSize: 9 },
  scoreBox: { flexDirection: "row", gap: 16, alignItems: "center", marginBottom: 14, padding: 10, backgroundColor: "#f8fafc", borderRadius: 4 },
  score: { fontSize: 26, fontWeight: 700 },
  group: { marginBottom: 12 },
  groupTitle: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 },
  item: { marginBottom: 5, paddingLeft: 8, borderLeftWidth: 2 },
  suggestion: { color: "#374151", fontSize: 9, marginTop: 1 },
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#9ca3af" },
});

export type PreflightReportData = {
  date: string;
  address: string;
  permit: string;
  jurisdiction: string;
  cycle: number;
  score: number;
  blockers: number;
  warnings: number;
  scoreLabel: string;
  rulesVersion: string;
  ranBy: string | null;
  ready: string | null;
  findings: { severity: "BLOCKER" | "WARNING" | "INFO"; message: string; suggestion?: string; source: string }[];
};

const GROUPS = [
  { severity: "BLOCKER", title: "Blockers", color: "#b91c1c" },
  { severity: "WARNING", title: "Warnings", color: "#b45309" },
  { severity: "INFO", title: "For information", color: "#475569" },
] as const;

function Report({ d }: { d: PreflightReportData }) {
  return (
    <Document title={`Permit readiness — ${d.address}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: 700 }}>{COMPANY.name}</Text>
            <Text style={styles.muted}>{d.address}</Text>
            <Text style={styles.muted}>{`${d.permit} · ${d.jurisdiction} · ${d.cycle ? `review cycle ${d.cycle}` : "not yet submitted"}`}</Text>
          </View>
          <View style={{ width: 200 }}>
            <Text style={[styles.title, { textAlign: "right" }]}>PERMIT READINESS REPORT</Text>
            <Text style={[styles.muted, { textAlign: "right" }]}>{d.date}</Text>
          </View>
        </View>
        <View style={styles.scoreBox}>
          <Text style={[styles.score, { color: d.blockers ? "#b91c1c" : d.warnings ? "#b45309" : "#15803d" }]}>{String(d.score)}</Text>
          <View style={{ flex: 1 }}>
            <Text>{`${d.blockers} blocker${d.blockers === 1 ? "" : "s"} · ${d.warnings} warning${d.warnings === 1 ? "" : "s"}${d.findings.some((f) => f.source === "ai") ? ` · ${d.findings.filter((f) => f.source === "ai").length} from the AI look (not scored)` : ""}`}</Text>
            <Text style={styles.muted}>{`${d.scoreLabel}. Rules ${d.rulesVersion}${d.ranBy ? ` · run by ${d.ranBy}` : ""}.`}</Text>
            {d.ready ? <Text style={[styles.muted, { color: "#15803d" }]}>{d.ready}</Text> : null}
          </View>
        </View>
        {GROUPS.map((g) => {
          const items = d.findings.filter((f) => f.severity === g.severity);
          if (!items.length) return null;
          return (
            <View key={g.severity} style={styles.group}>
              <Text style={[styles.groupTitle, { color: g.color }]}>{`${g.title} (${items.length})`}</Text>
              {items.map((f, i) => (
                <View key={i} style={[styles.item, { borderLeftColor: g.color }]} wrap={false}>
                  <Text>{f.source === "ai" ? `AI review: ${f.message}` : f.message}</Text>
                  {f.suggestion ? <Text style={styles.suggestion}>{f.suggestion}</Text> : null}
                </View>
              ))}
            </View>
          );
        })}
        {!d.findings.length ? <Text>Nothing found against the records.</Text> : null}
        <View style={styles.footer} fixed>
          <Text>Advisory: the building department decides. Product checks are not engineering determinations.</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPreflightReportPdf(d: PreflightReportData): Promise<Buffer> {
  return renderToBuffer(<Report d={d} />);
}
