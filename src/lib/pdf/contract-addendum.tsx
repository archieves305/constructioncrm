import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { AddendumSnapshot } from "@/lib/contracts/types";
import {
  styles,
  money,
  fmtDate,
  addressOneLine,
  DocHeader,
  Article,
  PartyColumn,
  SignatureBlock,
  ContractFooter,
} from "./contract-shared";

function signedMoney(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${money(Math.abs(n))}`;
}

function AddendumDoc({ data }: { data: AddendumSnapshot }) {
  const { company, job, owner, contractor, jobSite, changeOrder } = data;
  const ownerName = owner.companyName || owner.name;
  const contractorName = contractor.companyName || contractor.name;
  const generated = new Date(data.generatedAt);

  const original = data.originalContract;
  const revisedAmount =
    original != null
      ? original.contractAmount + changeOrder.priceAdjustment
      : null;

  return (
    <Document
      title={`Contract Addendum — ${job.jobNumber} — CO #${changeOrder.changeNumber}`}
      author={company.name}
    >
      <Page size="LETTER" style={styles.page}>
        <DocHeader
          company={company}
          docLabel="CONTRACT ADDENDUM"
          metaLines={[
            `Job #${job.jobNumber}`,
            `Change Order #${changeOrder.changeNumber}`,
            `Version ${data.versionNumber}`,
            `Generated ${generated.toLocaleDateString("en-US")}`,
          ]}
        />

        <Text style={styles.title}>
          CONSTRUCTION CONTRACT ADDENDUM / CHANGE ORDER ADDENDUM
        </Text>
        <Text style={styles.subtitle}>{job.title}</Text>

        <Text style={styles.intro}>
          This Addendum, dated {fmtDate(changeOrder.changeDate)}, modifies the
          construction labor agreement between{" "}
          <Text style={styles.bold}>{ownerName}</Text> (&quot;Owner&quot;) and{" "}
          <Text style={styles.bold}>{contractorName}</Text> (&quot;Labor
          Contractor&quot;) for the Project identified below. Except as expressly
          modified here, all terms of the original agreement remain in full force
          and effect.
        </Text>

        <Article n={1} title="PARTIES">
          <View style={styles.partyGrid}>
            <PartyColumn heading="Owner" party={owner} address={jobSite} />
            <PartyColumn heading="Labor Contractor" party={contractor} />
          </View>
        </Article>

        <Article n={2} title="REFERENCED PROJECT & CONTRACT">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Job number</Text>
            <Text style={styles.rowValue}>{job.jobNumber}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Job site</Text>
            <Text style={styles.rowValue}>{addressOneLine(jobSite)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Job type</Text>
            <Text style={styles.rowValue}>{job.jobTypeLabel}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Original labor amount</Text>
            <Text style={styles.rowValue}>
              {original != null ? money(original.contractAmount) : "—"}
            </Text>
          </View>
          {data.originalContractVersion != null ? (
            <View style={styles.rowLine}>
              <Text style={styles.rowLabel}>Original contract version</Text>
              <Text style={styles.rowValue}>
                v{data.originalContractVersion}
              </Text>
            </View>
          ) : null}
        </Article>

        <Article n={3} title="CHANGE ORDER DETAILS">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Change order number</Text>
            <Text style={[styles.rowValue, styles.bold]}>
              #{changeOrder.changeNumber}
            </Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Date</Text>
            <Text style={styles.rowValue}>
              {fmtDate(changeOrder.changeDate)}
            </Text>
          </View>
          {changeOrder.description ? (
            <View style={{ marginTop: 4 }}>
              <Text style={styles.bold}>Description of change:</Text>
              <View style={styles.scopeBox}>
                <Text>{changeOrder.description}</Text>
              </View>
            </View>
          ) : null}
        </Article>

        <Article n={4} title="ADDED SCOPE">
          <View style={styles.scopeBox}>
            <Text>
              {changeOrder.addedScope ||
                changeOrder.scopeChange ||
                "No scope added by this change order."}
            </Text>
          </View>
        </Article>

        <Article n={5} title="REMOVED SCOPE">
          <View style={styles.scopeBox}>
            <Text>
              {changeOrder.removedScope ||
                "No scope removed by this change order."}
            </Text>
          </View>
        </Article>

        <Article n={6} title="PRICE ADJUSTMENT">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Adjustment to labor amount</Text>
            <Text style={[styles.rowValue, styles.bold]}>
              {signedMoney(changeOrder.priceAdjustment)}
            </Text>
          </View>
          {original != null ? (
            <>
              <View style={styles.rowLine}>
                <Text style={styles.rowLabel}>Prior labor amount</Text>
                <Text style={styles.rowValue}>
                  {money(original.contractAmount)}
                </Text>
              </View>
              <View style={styles.rowLine}>
                <Text style={styles.rowLabel}>Revised labor amount</Text>
                <Text style={[styles.rowValue, styles.bold]}>
                  {money(revisedAmount as number)}
                </Text>
              </View>
            </>
          ) : null}
        </Article>

        <Article n={7} title="TIME ADJUSTMENT">
          <Text style={styles.body}>
            {changeOrder.timeAdjustmentDays != null &&
            changeOrder.timeAdjustmentDays !== 0
              ? `The completion schedule is adjusted by ${changeOrder.timeAdjustmentDays} calendar day(s).`
              : "No change to the completion schedule."}
          </Text>
        </Article>

        <Article n={8} title="PAYMENT IMPACT">
          <Text style={styles.body}>
            {changeOrder.paymentImpact ||
              changeOrder.updatedPaymentTerms ||
              "No change to the payment terms of the original agreement."}
          </Text>
        </Article>

        <Article n={9} title="RETAINAGE IMPACT">
          <Text style={styles.body}>
            {changeOrder.retainageImpact ||
              "Retainage continues to apply to the adjusted amount per the original agreement."}
          </Text>
        </Article>

        <Article n={10} title="AGREEMENT">
          <Text style={styles.body}>
            This Addendum is incorporated into and made part of the original
            construction labor agreement. In the event of a conflict between this
            Addendum and the original agreement, this Addendum controls as to the
            matters expressly addressed herein.
          </Text>
          <Text style={[styles.body, styles.bold, { marginTop: 4 }]}>
            No change order, extra work, or added scope is valid unless approved
            in writing before the work begins.
          </Text>
        </Article>

        <View wrap={false}>
          <Text style={[styles.articleHeading, { marginTop: 8 }]}>
            SIGNATURES
          </Text>
          <Text style={[styles.body, { marginBottom: 4 }]}>
            By signing below, the Parties approve this change order addendum.
          </Text>
          <SignatureBlock
            ownerName={ownerName}
            contractorName={contractorName}
          />
        </View>

        <ContractFooter
          company={company}
          rightMeta={`Addendum · Job #${job.jobNumber} · CO #${changeOrder.changeNumber} · v${data.versionNumber}`}
        />
      </Page>
    </Document>
  );
}

export async function renderContractAddendumPdf(
  data: AddendumSnapshot,
): Promise<Buffer> {
  return renderToBuffer(<AddendumDoc data={data} />);
}
