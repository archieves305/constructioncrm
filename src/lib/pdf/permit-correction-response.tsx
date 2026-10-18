import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY } from "./company";

/**
 * The point-by-point answer to a building department's correction notice:
 * each comment as the department wrote it, KNU's response, and the sheets or
 * documents revised. Rendered from the confirmed items only.
 */
const styles = StyleSheet.create({
  page: { padding: 48, paddingBottom: 64, fontSize: 10.5, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  companyName: { fontSize: 15, fontWeight: 700 },
  docLabel: { fontSize: 12, fontWeight: 700, color: "#1e3a5f", textAlign: "right" },
  muted: { color: "#6b7280", fontSize: 9.5 },
  block: { marginBottom: 14 },
  label: { fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", marginBottom: 2 },
  row: { flexDirection: "row", gap: 24 },
  item: { marginBottom: 12, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  itemHead: { fontSize: 10, fontWeight: 700, marginBottom: 3 },
  comment: { color: "#374151", fontStyle: "italic", marginBottom: 4 },
  response: {},
  revised: { marginTop: 3, fontSize: 9.5, color: "#374151" },
  footer: { position: "absolute", bottom: 28, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 8.5, color: "#9ca3af" },
});

export type CorrectionResponseData = {
  date: string;
  jurisdiction: string;
  address: string;
  permitType: string | null;
  applicationNumber: string | null;
  permitNumber: string | null;
  cycle: number;
  reviewerName: string | null;
  noticeDate: string;
  lines: { number: string; discipline: string | null; comment: string; response: string; revised: string[] }[];
  signer: string;
};

function CorrectionResponseDoc({ d }: { d: CorrectionResponseData }) {
  return (
    <Document title={`Response to plan review comments — ${d.address}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={styles.companyName}>{COMPANY.name}</Text>
            <Text style={styles.muted}>{COMPANY.address}</Text>
            <Text style={styles.muted}>{COMPANY.phone}</Text>
          </View>
          <View style={{ width: 260 }}>
            <Text style={styles.docLabel}>RESPONSE TO PLAN REVIEW COMMENTS</Text>
            <Text style={[styles.muted, { textAlign: "right" }]}>{d.date}</Text>
          </View>
        </View>

        <View style={[styles.block, styles.row]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>To</Text>
            <Text>{d.jurisdiction} — Building Department</Text>
            {d.reviewerName ? <Text style={styles.muted}>Attn: {d.reviewerName}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Project</Text>
            <Text>{d.address}</Text>
            <Text style={styles.muted}>{[d.permitType ? `${d.permitType} permit` : null, d.applicationNumber ? `Application ${d.applicationNumber}` : null, d.permitNumber ? `Permit ${d.permitNumber}` : null].filter(Boolean).join(" · ")}</Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.response}>
            {`The comments of ${d.noticeDate} on review cycle ${d.cycle} are answered below, point by point. Revised documents are included with this resubmission as listed under each comment.`}
          </Text>
        </View>

        {d.lines.map((l, i) => (
          <View key={i} style={styles.item} wrap={false}>
            <Text style={styles.itemHead}>
              {`Comment ${l.number}`}
              {l.discipline ? ` — ${l.discipline}` : ""}
            </Text>
            <Text style={styles.comment}>{l.comment}</Text>
            <Text style={styles.label}>Response</Text>
            <Text style={styles.response}>{l.response}</Text>
            {l.revised.length ? <Text style={styles.revised}>{`Revised: ${l.revised.join(", ")}`}</Text> : null}
          </View>
        ))}

        <View style={[styles.block, { marginTop: 8 }]}>
          <Text>Respectfully submitted,</Text>
          <Text style={{ marginTop: 18, fontWeight: 700 }}>{d.signer}</Text>
          <Text style={styles.muted}>{COMPANY.name}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{d.address}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCorrectionResponsePdf(d: CorrectionResponseData): Promise<Buffer> {
  return renderToBuffer(<CorrectionResponseDoc d={d} />);
}
