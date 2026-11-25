import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY } from "./company";
import { boxOnPrint, printSize, type ReportFinding, type ReportModel } from "@/lib/inspector/report";
import type { Severity } from "@/lib/inspector/state";

// The AI Field Inspector's report: the inspection, then each area's photos
// with the confirmed findings boxed and numbered, then the list. Built from
// `buildReport` (lib/inspector/report.ts), which keeps out everything a
// person has not confirmed.

const ACCENT = "#2B5F94";
const RULE = "#d6d3d1";
const PHOTO_MAX_W = 320;
const PHOTO_MAX_H = 260;
/** Room above a photo for the area's heading (top margin, heading, gap). */
const HEADING_H = 18 + 18 + 6;
/** Gap above and below a photo. */
const PHOTO_GAP = 6;
/** Letter width less the page padding. */
const CONTENT_W = 612 - 2 * 44;

const SEVERITY_COLOR: Record<Severity, string> = { CRITICAL: "#b91c1c", MAJOR: "#c2410c", MINOR: "#a16207", COSMETIC: "#57534e" };
const STATUS_COLOR: Record<ReportFinding["status"], string> = { Open: "#b91c1c", "Punch item open": "#a16207", Fixed: "#15803d" };

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 60, paddingHorizontal: 44, fontSize: 10, fontFamily: "Helvetica", color: "#1c1917" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: ACCENT },
  brandRow: { flexDirection: "row", alignItems: "center", maxWidth: 290 },
  logo: { width: 54, height: 54, objectFit: "contain", marginRight: 10 },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: "#78716c", fontSize: 9 },
  docBox: { alignItems: "flex-end" },
  docLabel: { fontSize: 16, fontFamily: "Helvetica-Bold", color: ACCENT, letterSpacing: 0.5 },
  docMeta: { fontSize: 9, marginTop: 2 },
  band: { marginTop: 10, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 3, fontSize: 9, fontFamily: "Helvetica-Bold" },
  infoGrid: { flexDirection: "row", marginTop: 12 },
  infoCell: { flex: 1, borderWidth: 1, borderColor: RULE, padding: 8 },
  infoLeft: { marginRight: 8 },
  cellTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#78716c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  strong: { fontFamily: "Helvetica-Bold" },
  totals: { flexDirection: "row", marginTop: 10, flexWrap: "wrap" },
  chip: { fontSize: 9, marginRight: 12, marginTop: 2 },
  areaTitle: { marginTop: 18, marginBottom: 6, paddingBottom: 3, fontSize: 11, fontFamily: "Helvetica-Bold", color: ACCENT, borderBottomWidth: 1, borderBottomColor: RULE },
  none: { fontSize: 9, color: "#78716c", fontStyle: "italic" },
  // a photo block has a fixed size and places everything in it absolutely: react-pdf drops or splits an
  // unbreakable block that moves to the next page when its children flow (margins, nested blocks)
  photoBlock: { position: "relative" },
  blockTitle: { position: "absolute", left: 0, right: 0, top: 18, height: 18, paddingBottom: 3, fontSize: 11, fontFamily: "Helvetica-Bold", color: ACCENT, borderBottomWidth: 1, borderBottomColor: RULE },
  box: { position: "absolute", borderWidth: 1.5, borderColor: "#ef4444" },
  boxLabel: { position: "absolute", top: -1.5, left: -1.5, backgroundColor: "#ef4444", color: "#fff", fontSize: 7, fontFamily: "Helvetica-Bold", paddingHorizontal: 2, paddingVertical: 1 },
  finding: { flexDirection: "row", marginBottom: 7 },
  num: { width: 18, height: 14, backgroundColor: "#ef4444", color: "#fff", fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 2, marginRight: 8 },
  fBody: { flex: 1 },
  fTitle: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  fMeta: { fontSize: 8, marginTop: 1 },
  // fontSize beside lineHeight: react-pdf otherwise scales the line height from 18pt.
  fText: { fontSize: 9, lineHeight: 1.35, marginTop: 2, color: "#292524" },
  disclaimer: { marginTop: 10, padding: 8, backgroundColor: "#f5f5f4", fontSize: 8, lineHeight: 1.4, color: "#44403c" },
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#a8a29e", borderTopWidth: 1, borderTopColor: "#e7e5e4", paddingTop: 5 },
});

export type ReportBrand = {
  companyName: string;
  addressLines: string[];
  phone: string | null;
  email: string | null;
  license: string | null;
  logoDataUri: string | null;
} | null;

function day(d: Date) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
}

function FindingRow({ f }: { f: ReportFinding }) {
  return (
    <View style={styles.finding} wrap={false}>
      <Text style={styles.num}>{f.n}</Text>
      <View style={styles.fBody}>
        <Text style={styles.fTitle}>{f.title}</Text>
        <Text style={styles.fMeta}>
          <Text style={{ color: SEVERITY_COLOR[f.severity], fontFamily: "Helvetica-Bold" }}>{f.severityLabel}</Text>
          <Text style={{ color: "#78716c" }}>{`  ·  ${f.trade}  ·  `}</Text>
          <Text style={{ color: STATUS_COLOR[f.status], fontFamily: "Helvetica-Bold" }}>{f.status}</Text>
          {f.addedByPerson ? <Text style={{ color: "#78716c" }}>{"  ·  added by the inspector"}</Text> : null}
        </Text>
        {f.evidence ? <Text style={styles.fText}>{f.evidence}</Text> : null}
        {f.action ? <Text style={styles.fText}>Fix: {f.action}</Text> : null}
        {f.physicalCheck ? <Text style={styles.fText}>Check on site: {f.physicalCheck}</Text> : null}
      </View>
    </View>
  );
}

function ReportDoc({ m, brand, photos }: { m: ReportModel; brand: ReportBrand; photos: Map<string, string> }) {
  const companyName = brand?.companyName || COMPANY.name;
  const addressLines = brand?.addressLines.length ? brand.addressLines : [COMPANY.address];
  const phone = brand?.phone || COMPANY.phone;
  const band = m.draft
    ? { bg: "#fef3c7", fg: "#92400e" }
    : m.statusLine.startsWith("Work accepted")
      ? { bg: "#dcfce7", fg: "#166534" }
      : { bg: "#f5f5f4", fg: "#57534e" };

  return (
    <Document title={`Inspection ${m.number} — ${m.place}`} author={companyName}>
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
              <Text style={styles.muted}>{[phone, brand?.email].filter(Boolean).join("  ·  ")}</Text>
              {brand?.license ? <Text style={styles.muted}>Lic. {brand.license}</Text> : null}
            </View>
          </View>
          <View style={styles.docBox}>
            <Text style={styles.docLabel}>INSPECTION REPORT</Text>
            <Text style={styles.docMeta}>{m.number}</Text>
            <Text style={styles.docMeta}>{day(m.createdAt)}</Text>
            {m.jobCode ? <Text style={styles.docMeta}>{m.jobCode}</Text> : null}
          </View>
        </View>

        <Text style={[styles.band, { backgroundColor: band.bg, color: band.fg }]}>
          {m.statusLine}
          {m.toReview ? ` — ${m.toReview} AI finding${m.toReview === 1 ? "" : "s"} not yet reviewed and not shown` : ""}
        </Text>

        <View style={styles.infoGrid}>
          <View style={[styles.infoCell, styles.infoLeft]}>
            <Text style={styles.cellTitle}>Property</Text>
            <Text style={styles.strong}>{m.place}</Text>
            <Text>{m.title}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.cellTitle}>Inspection</Text>
            <Text>{m.kindLabel}</Text>
            <Text style={styles.muted}>Quality bar: {m.qualityLabel}</Text>
            {m.contractor ? <Text style={styles.muted}>Contractor: {m.contractor}</Text> : null}
            {m.startedBy ? <Text style={styles.muted}>Inspected by {m.startedBy}</Text> : null}
          </View>
        </View>

        <View style={styles.totals}>
          <Text style={[styles.chip, styles.strong]}>
            {m.totals.findings} finding{m.totals.findings === 1 ? "" : "s"}
          </Text>
          {m.totals.bySeverity.map((s) => (
            <Text key={s.severity} style={[styles.chip, { color: SEVERITY_COLOR[s.severity] }]}>
              {s.count} {s.label.toLowerCase()}
            </Text>
          ))}
          <Text style={styles.chip}>{m.totals.open} open</Text>
          <Text style={styles.chip}>{m.totals.fixed} fixed</Text>
          <Text style={[styles.chip, { color: "#78716c" }]}>{m.totals.photos} photos taken</Text>
        </View>
        {m.acceptOverride ? <Text style={[styles.fText, { marginTop: 6 }]}>Accepted with open items: {m.acceptOverride}</Text> : null}
        <Text style={styles.disclaimer}>{m.disclaimer}</Text>

        {m.areas.map((a) => {
          const headingText = (
            <>
              {a.name}
              {a.trade ? <Text style={styles.muted}>{`   ${a.trade}`}</Text> : null}
              <Text style={styles.muted}>{`   ${a.photoCount} photo${a.photoCount === 1 ? "" : "s"}`}</Text>
            </>
          );
          const heading = <Text style={styles.areaTitle}>{headingText}</Text>;
          return (
            <View key={a.name}>
              {!a.photos.length ? (
                <View wrap={false}>
                  {heading}
                  {!a.unplaced.length ? <Text style={styles.none}>No findings recorded in this area.</Text> : null}
                </View>
              ) : null}
              {a.photos.map((p, pi) => {
                const src = photos.get(p.photoId);
                const size = printSize(p, PHOTO_MAX_W, PHOTO_MAX_H);
                const top = (pi === 0 ? HEADING_H : 0) + PHOTO_GAP;
                // the area's heading rides in its first photo's block, so it never sits alone at a page's foot.
                // A fragment, not a View: react-pdf lays an unbreakable block over the page's foot when it sits in a View with siblings after it.
                return (
                  <React.Fragment key={p.photoId}>
                    <View wrap={false} style={[styles.photoBlock, { width: CONTENT_W, height: top + size.height + PHOTO_GAP }]}>
                      {pi === 0 ? <Text style={styles.blockTitle}>{headingText}</Text> : null}
                      {src ? (
                        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
                        <Image src={src} style={{ position: "absolute", left: 0, top, width: size.width, height: size.height }} />
                      ) : (
                        <Text style={[styles.none, { position: "absolute", left: 0, top }]}>Photo not available.</Text>
                      )}
                      {src
                        ? p.findings.flatMap((f) =>
                            f.boxes.map((b, i) => {
                              const r = boxOnPrint(b, p, size);
                              return (
                                <View key={`${f.n}-${i}`} style={[styles.box, { left: r.left, top: top + r.top, width: r.width, height: r.height }]}>
                                  {i === 0 ? <Text style={styles.boxLabel}>{f.n}</Text> : null}
                                </View>
                              );
                            }),
                          )
                        : null}
                    </View>
                    {p.findings.map((f) => (
                      <FindingRow key={f.n} f={f} />
                    ))}
                  </React.Fragment>
                );
              })}
              {a.unplaced.map((f) => (
                <FindingRow key={f.n} f={f} />
              ))}
            </View>
          );
        })}

        <View style={styles.footer} fixed>
          <Text>
            {companyName} · Inspection {m.number}
            {m.draft ? " · DRAFT" : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** `photos` maps a photo id to a data URI; a missing one prints "Photo not available". */
export async function renderInspectionReportPdf(m: ReportModel, brand: ReportBrand, photos: Map<string, string>): Promise<Buffer> {
  return renderToBuffer(<ReportDoc m={m} brand={brand} photos={photos} />);
}
