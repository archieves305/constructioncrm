import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { addressOneLine, money, PartyColumn, styles as shared } from "./contract-shared";
import type { ContractParty } from "@/lib/contracts/types";
import type { CustomerContractSnapshot, ScopeSection } from "@/lib/customer-contracts/types";

// Customer-facing construction agreement. Unsigned: blank owner signature
// block. Signed (snapshot.signature set): the drawn signature, the typed name,
// and a final Signature Certificate page that forms part of the record.

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#0f766e",
  },
  brandBlock: { flexDirection: "row", gap: 10, alignItems: "center", maxWidth: 330 },
  logo: { width: 70, height: 52, objectFit: "contain" },
  companyName: { fontSize: 14, fontWeight: 700, color: "#0f766e" },
  right: { alignItems: "flex-end" },
  docLabel: { fontSize: 12, fontWeight: 700, textAlign: "right" },
  docMeta: { fontSize: 8.5, color: "#6b7280", textAlign: "right" },
  title: { fontSize: 15, fontWeight: 700, textAlign: "center", marginTop: 4, marginBottom: 2 },
  subtitle: { fontSize: 9, textAlign: "center", color: "#6b7280", marginBottom: 10 },
  block: { marginBottom: 9 },
  heading: { fontSize: 10.5, fontWeight: 700, color: "#0f766e", marginBottom: 3 },
  para: { marginBottom: 3 },
  bullet: { marginLeft: 12, marginBottom: 2 },
  muted: { color: "#6b7280", fontSize: 9 },
  scopeSection: { fontSize: 10, fontWeight: 700, marginTop: 6, marginBottom: 2 },
  lineHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 3,
    marginTop: 2,
    fontWeight: 700,
    fontSize: 8.5,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  lineRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#eee" },
  colDesc: { flex: 4 },
  colQty: { flex: 1.2, textAlign: "right" },
  colAmt: { flex: 1.6, textAlign: "right" },
  optionTag: { fontSize: 8, color: "#0f766e" },
  totalBox: {
    marginTop: 6,
    padding: 10,
    backgroundColor: "#ecfdf5",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#10b981",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 9.5, color: "#065f46", textTransform: "uppercase" },
  totalValue: { fontSize: 18, fontWeight: 700, color: "#047857" },
  priceLine: { flexDirection: "row", justifyContent: "space-between", marginVertical: 1 },
  sigRow: { flexDirection: "row", gap: 28, marginTop: 14 },
  sigCol: { flex: 1 },
  sigImage: { width: 180, height: 56, objectFit: "contain", objectPositionX: 0 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: "#111", height: 22, marginBottom: 2 },
  sigLineSigned: { borderBottomWidth: 1, borderBottomColor: "#111", marginBottom: 2 },
  sigLabel: { fontSize: 8.5, color: "#6b7280" },
  certRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#eee" },
  certKey: { width: 150, color: "#6b7280", fontSize: 9 },
  certVal: { flex: 1, fontSize: 9 },
  mono: { fontFamily: "Courier", fontSize: 8 },
  certNote: { marginTop: 10, fontSize: 8.5, color: "#6b7280", fontStyle: "italic" },
  footerLine: { position: "absolute", bottom: 24, left: 54, right: 54, textAlign: "center", fontSize: 7.5, color: "#9ca3af" },
});

function fmtDateTime(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: tz, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
}

function Header({ snap }: { snap: CustomerContractSnapshot }) {
  const c = snap.company;
  return (
    <View style={s.header} fixed>
      <View style={s.brandBlock}>
        {c.logoDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image style={s.logo} src={c.logoDataUri} />
        ) : null}
        <View>
          <Text style={s.companyName}>{c.name}</Text>
          {c.address ? <Text style={s.muted}>{c.address}</Text> : null}
          <Text style={s.muted}>
            {[c.phone, c.email, c.website].filter(Boolean).join(" · ")}
          </Text>
          {c.licenses.length > 0 ? <Text style={s.muted}>Licensed &amp; Insured · {c.licenses.map((l) => `Lic #${l}`).join(" · ")}</Text> : null}
        </View>
      </View>
      <View style={s.right}>
        <Text style={s.docLabel}>{snap.signature ? "SIGNED AGREEMENT" : "CUSTOMER AGREEMENT"}</Text>
        <Text style={s.docMeta}>Contract No. {snap.contractNumber} · v{snap.versionNumber}</Text>
        <Text style={s.docMeta}>Dated {fmtDate(snap.generatedAt)}</Text>
        <Text style={s.docMeta}>Ref. {snap.source.estimateNumber}</Text>
      </View>
    </View>
  );
}

function Paragraphs({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => {
        const lines = p.split("\n");
        const isList = lines.every((l) => /^\s*-\s+/.test(l));
        if (isList) {
          return (
            <View key={i} style={s.para}>
              {lines.map((l, j) => (
                <Text key={j} style={s.bullet}>
                  • {l.replace(/^\s*-\s+/, "")}
                </Text>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={s.para}>
            {lines.join(" ")}
          </Text>
        );
      })}
    </>
  );
}

function ArticleBlock({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={s.block}>
      <Text style={s.heading} minPresenceAhead={90}>
        {n}. {title}
      </Text>
      {children}
    </View>
  );
}

function ScopeTable({ sections }: { sections: ScopeSection[] }) {
  return (
    <View>
      {sections.map((sec, si) => (
        <View key={si}>
          <Text style={s.scopeSection}>{sec.title}</Text>
          <View style={s.lineHeader}>
            <Text style={s.colDesc}>Description</Text>
            <Text style={s.colQty}>Qty</Text>
          </View>
          {sec.items.map((it, ii) => (
            <View key={ii} style={s.lineRow} wrap={false}>
              <View style={s.colDesc}>
                <Text>
                  {it.description}
                  {it.wasOptional ? <Text style={s.optionTag}>  (selected option)</Text> : null}
                </Text>
                {it.notes ? <Text style={s.muted}>{it.notes}</Text> : null}
              </View>
              <Text style={s.colQty}>{it.quantity != null ? `${it.quantity} ${it.unitType ?? ""}`.trim() : "—"}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function OwnerSignature({ snap }: { snap: CustomerContractSnapshot }) {
  const sig = snap.signature;
  return (
    <View style={s.sigCol}>
      {sig ? (
        <>
          <View style={s.sigLineSigned}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={s.sigImage} src={sig.signatureDataUri} />
          </View>
          <Text style={s.sigLabel}>Owner signature — electronically signed</Text>
          <Text style={[shared.bold, { marginTop: 8 }]}>{sig.signerName}</Text>
          <Text style={s.sigLabel}>Printed name</Text>
          <Text style={{ marginTop: 8 }}>{fmtDateTime(sig.signedAt, "America/New_York")}</Text>
          <Text style={s.sigLabel}>Date</Text>
        </>
      ) : (
        <>
          <View style={s.sigLine} />
          <Text style={s.sigLabel}>Owner signature</Text>
          <View style={[s.sigLine, { marginTop: 14 }]} />
          <Text style={s.sigLabel}>Printed name: {snap.owner.name}</Text>
          <View style={[s.sigLine, { marginTop: 14 }]} />
          <Text style={s.sigLabel}>Date</Text>
        </>
      )}
    </View>
  );
}

function ContractorSignature({ snap }: { snap: CustomerContractSnapshot }) {
  return (
    <View style={s.sigCol}>
      <View style={s.sigLine} />
      <Text style={s.sigLabel}>Contractor — authorized representative</Text>
      <View style={[s.sigLine, { marginTop: 14 }]} />
      <Text style={s.sigLabel}>Printed name and title</Text>
      <View style={[s.sigLine, { marginTop: 14 }]} />
      <Text style={s.sigLabel}>Date · {snap.company.name}</Text>
    </View>
  );
}

function Footer({ snap }: { snap: CustomerContractSnapshot }) {
  return (
    <Text
      style={s.footerLine}
      fixed
      render={({ pageNumber, totalPages }) => `${snap.company.name} · ${snap.contractNumber} v${snap.versionNumber} · Page ${pageNumber} of ${totalPages}`}
    />
  );
}

function CertRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={s.certRow} wrap={false}>
      <Text style={s.certKey}>{k}</Text>
      <Text style={[s.certVal, mono ? s.mono : {}]}>{v}</Text>
    </View>
  );
}

function CertificatePage({ snap }: { snap: CustomerContractSnapshot }) {
  const sig = snap.signature!;
  return (
    <Page size="LETTER" style={shared.page}>
      <Header snap={snap} />
      <Text style={s.title}>Signature Certificate</Text>
      <Text style={s.subtitle}>Electronic signature record for {snap.contractNumber}</Text>
      <CertRow k="Document" v={`${snap.template.title} — ${snap.contractNumber} v${snap.versionNumber}`} />
      <CertRow k="Contract record id" v={sig.contractId} mono />
      <CertRow k="Template" v={`${snap.template.key} v${snap.template.version}`} />
      <CertRow k="Contract price" v={money(snap.price.total)} />
      <CertRow k="Sent" v={`${fmtDateTime(sig.sentAt, "America/New_York")}${sig.sentToEmail ? ` to ${sig.sentToEmail}` : ""}`} />
      <CertRow k="Unsigned PDF SHA-256" v={sig.unsignedPdfSha256} mono />
      <CertRow k="Signing link (SHA-256)" v={sig.tokenSha256} mono />
      <CertRow k="Signer name" v={sig.signerName} />
      <CertRow k="Signer email" v={sig.signerEmail ?? "—"} />
      <CertRow k="Consent given" v={fmtDateTime(sig.consentAt, "America/New_York")} />
      <CertRow k="Consent text" v={sig.consentText} />
      <CertRow k="Signed" v={`${fmtDateTime(sig.signedAt, "America/New_York")} (${fmtDateTime(sig.signedAt, "UTC")})`} />
      <CertRow k="IP address" v={sig.ip ?? "—"} mono />
      <CertRow k="Browser" v={sig.userAgent ?? "—"} />
      <View style={[s.certRow, { alignItems: "center" }]} wrap={false}>
        <Text style={s.certKey}>Signature</Text>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image style={s.sigImage} src={sig.signatureDataUri} />
      </View>
      <Text style={s.certNote}>
        Electronically signed via KNU Construction CRM. This page is generated by the system at the moment of signing and forms part of the signed record. The
        SHA-256 above identifies the exact unsigned document that was sent to and reviewed by the signer.
      </Text>
      <Footer snap={snap} />
    </Page>
  );
}

function ContractDoc({ snap }: { snap: CustomerContractSnapshot }) {
  const contractor: ContractParty = {
    name: snap.company.name,
    phone: snap.company.phone,
    email: snap.company.email,
    license: snap.company.licenses.join(", ") || null,
  };
  let n = 0;
  const next = () => ++n;
  return (
    <Document title={`${snap.template.title} — ${snap.contractNumber}`} author={snap.company.name}>
      <Page size="LETTER" style={shared.page}>
        <Header snap={snap} />
        <Text style={s.title}>{snap.template.title}</Text>
        <Text style={s.subtitle}>
          Project {snap.job.jobNumber} — {snap.job.title}
        </Text>

        <View style={[shared.partyGrid, { marginBottom: 10 }]}>
          <PartyColumn heading="Contractor" party={contractor} />
          <PartyColumn heading="Owner" party={snap.owner} address={snap.jobSite} />
        </View>
        <View style={shared.rowLine}>
          <Text style={shared.rowLabel}>Property</Text>
          <Text style={shared.rowValue}>{addressOneLine(snap.jobSite)}</Text>
        </View>
        <View style={[shared.rowLine, { marginBottom: 8 }]}>
          <Text style={shared.rowLabel}>Price valid through</Text>
          <Text style={shared.rowValue}>{fmtDate(snap.validity.offerExpiresAt)}</Text>
        </View>

        <ArticleBlock n={next()} title="Scope of Work">
          <ScopeTable sections={snap.scope.sections} />
          {snap.scope.summaryLines.length > 0 ? (
            <View style={{ marginTop: 4 }}>
              {snap.scope.summaryLines.map((l, i) => (
                <Text key={i} style={s.bullet}>
                  • {l}
                </Text>
              ))}
            </View>
          ) : null}
          {snap.scope.notes ? (
            <Text style={[s.para, { marginTop: 4 }]}>
              <Text style={shared.bold}>Notes: </Text>
              {snap.scope.notes}
            </Text>
          ) : null}
          {snap.scope.specialTerms ? (
            <Text style={[s.para, { marginTop: 4 }]}>
              <Text style={shared.bold}>Special terms: </Text>
              {snap.scope.specialTerms}
            </Text>
          ) : null}
          {snap.scope.exclusions ? (
            <Text style={[s.para, { marginTop: 4 }]}>
              <Text style={shared.bold}>Exclusions: </Text>
              {snap.scope.exclusions}
            </Text>
          ) : null}
        </ArticleBlock>

        <ArticleBlock n={next()} title="Contract Price">
          {snap.price.discountAmount > 0 || snap.price.salesTaxAmount > 0 ? (
            <View>
              <View style={s.priceLine}>
                <Text>Subtotal</Text>
                <Text>{money(snap.price.subtotal)}</Text>
              </View>
              {snap.price.discountAmount > 0 ? (
                <View style={s.priceLine}>
                  <Text>Discount</Text>
                  <Text>−{money(snap.price.discountAmount)}</Text>
                </View>
              ) : null}
              {snap.price.salesTaxAmount > 0 ? (
                <View style={s.priceLine}>
                  <Text>Sales tax</Text>
                  <Text>{money(snap.price.salesTaxAmount)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={s.totalBox} wrap={false}>
            <Text style={s.totalLabel}>Total contract price</Text>
            <Text style={s.totalValue}>{money(snap.price.total)}</Text>
          </View>
        </ArticleBlock>

        <ArticleBlock n={next()} title="Payment Schedule">
          {snap.template.paymentScheduleText ? <Paragraphs body={snap.template.paymentScheduleText} /> : null}
          <View style={s.lineHeader}>
            <Text style={s.colDesc}>Stage</Text>
            <Text style={[s.colDesc, { flex: 3 }]}>Due</Text>
            <Text style={s.colAmt}>Amount</Text>
          </View>
          {snap.paymentSchedule.map((row) => (
            <View key={row.key} style={s.lineRow} wrap={false}>
              <Text style={s.colDesc}>
                {row.label} ({row.percent}%)
              </Text>
              <Text style={[s.colDesc, { flex: 3 }]}>{row.trigger}</Text>
              <Text style={s.colAmt}>{money(row.amount)}</Text>
            </View>
          ))}
          <View style={[s.lineRow, { borderBottomWidth: 0 }]}>
            <Text style={[s.colDesc, shared.bold]}>Total</Text>
            <Text style={[s.colDesc, { flex: 3 }]} />
            <Text style={[s.colAmt, shared.bold]}>{money(snap.price.total)}</Text>
          </View>
        </ArticleBlock>

        {snap.template.articles.map((a) => (
          <ArticleBlock key={a.key} n={next()} title={a.title}>
            <Paragraphs body={a.body} />
          </ArticleBlock>
        ))}

        <View wrap={false}>
          <Text style={[s.heading, { marginTop: 6 }]}>Signatures</Text>
          <Text style={s.para}>
            By signing below, the parties agree to the terms of this Agreement, including the Scope of Work, Contract Price and Payment Schedule above.
          </Text>
          <View style={s.sigRow}>
            <OwnerSignature snap={snap} />
            <ContractorSignature snap={snap} />
          </View>
        </View>

        <Footer snap={snap} />
      </Page>
      {snap.signature ? <CertificatePage snap={snap} /> : null}
    </Document>
  );
}

export async function renderCustomerContractPdf(snapshot: CustomerContractSnapshot): Promise<Buffer> {
  return renderToBuffer(<ContractDoc snap={snapshot} />);
}
