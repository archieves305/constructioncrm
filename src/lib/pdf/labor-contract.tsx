import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { LaborContractSnapshot } from "@/lib/contracts/types";
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

function LaborContractDoc({ data }: { data: LaborContractSnapshot }) {
  const { company, job, owner, contractor, jobSite, terms } = data;
  const ownerName = owner.companyName || owner.name;
  const contractorName = contractor.companyName || contractor.name;
  const generated = new Date(data.generatedAt);

  return (
    <Document
      title={`Labor Contract — ${job.jobNumber} — ${contractor.name}`}
      author={company.name}
    >
      <Page size="LETTER" style={styles.page}>
        <DocHeader
          company={company}
          docLabel="CONSTRUCTION LABOR AGREEMENT"
          metaLines={[
            `Job #${job.jobNumber}`,
            `Version ${data.versionNumber}`,
            `Generated ${generated.toLocaleDateString("en-US")}`,
          ]}
        />

        <Text style={styles.title}>CONSTRUCTION LABOR AGREEMENT</Text>
        <Text style={styles.subtitle}>{job.title}</Text>

        <Text style={styles.intro}>
          This Construction Labor Agreement (the &quot;Agreement&quot;) is
          entered into as of {fmtDate(data.generatedAt)} by and between{" "}
          <Text style={styles.bold}>{ownerName}</Text> (&quot;Owner&quot;) and{" "}
          <Text style={styles.bold}>{contractorName}</Text> (&quot;Labor
          Contractor&quot;), for labor services at the project described below.
          Owner and Labor Contractor are each a &quot;Party&quot; and together
          the &quot;Parties.&quot;
        </Text>

        <Article n={1} title="PARTIES">
          <View style={styles.partyGrid}>
            <PartyColumn heading="Owner" party={owner} address={jobSite} />
            <PartyColumn heading="Labor Contractor" party={contractor} />
          </View>
          {contractor.insurance ? (
            <Text style={styles.muted}>
              Contractor insurance: {contractor.insurance}
            </Text>
          ) : null}
        </Article>

        <Article n={2} title="PROJECT / JOB SITE">
          <Text style={styles.body}>
            The work shall be performed at the following project / job site
            (the &quot;Project&quot;):
          </Text>
          <Text style={styles.bold}>{addressOneLine(jobSite)}</Text>
          <View style={[styles.rowLine, { marginTop: 4 }]}>
            <Text style={styles.rowLabel}>Job number</Text>
            <Text style={styles.rowValue}>{job.jobNumber}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Project / service type</Text>
            <Text style={styles.rowValue}>{job.serviceType}</Text>
          </View>
        </Article>

        <Article n={3} title="JOB TYPE">
          <Text style={styles.body}>
            This Agreement is issued under a{" "}
            <Text style={styles.bold}>{job.jobTypeLabel}</Text> job arrangement.
            The Labor Contractor&apos;s compensation is governed by the Payment
            Terms in Article 7 regardless of the Owner&apos;s underlying job
            type.
          </Text>
        </Article>

        <Article n={4} title="SCOPE OF WORK">
          <Text style={styles.body}>
            The Labor Contractor shall furnish all labor, supervision, and
            workmanship necessary to perform the following scope of work
            (the &quot;Work&quot;):
          </Text>
          <View style={styles.scopeBox}>
            <Text>{terms.scopeOfWork}</Text>
          </View>
          {terms.exclusions ? (
            <View style={{ marginTop: 6 }}>
              <Text style={styles.bold}>Exclusions:</Text>
              <Text>{terms.exclusions}</Text>
            </View>
          ) : null}
        </Article>

        <Article n={5} title="LABOR CONTRACTOR RESPONSIBILITIES">
          <Text style={styles.bullet}>
            • Perform the Work in a good and workmanlike manner consistent with
            industry standards and applicable code.
          </Text>
          <Text style={styles.bullet}>
            • Supply all labor, supervision, tools, and small consumables
            required to complete the Work unless stated otherwise herein.
          </Text>
          <Text style={styles.bullet}>
            • Maintain a safe job site and comply with all applicable safety
            (OSHA) requirements.
          </Text>
          <Text style={styles.bullet}>
            • Perform reasonable daily cleanup and remove labor-generated debris
            from work areas.
          </Text>
          <Text style={styles.bullet}>
            • Coordinate scheduling and progress with the Owner or
            Owner&apos;s representative.
          </Text>
        </Article>

        <Article n={6} title="OWNER RESPONSIBILITIES">
          <Text style={styles.bullet}>
            • Provide timely access to the job site and work areas.
          </Text>
          <Text style={styles.bullet}>
            • Make payments in accordance with the Payment Terms below.
          </Text>
          <Text style={styles.bullet}>
            • Furnish materials and equipment except those the Labor Contractor
            has agreed to provide (see Article 9).
          </Text>
          <Text style={styles.bullet}>
            • Obtain or fund permits except as otherwise agreed (see Article
            10).
          </Text>
        </Article>

        <Article n={7} title="PAYMENT TERMS">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Total labor amount</Text>
            <Text style={[styles.rowValue, styles.bold]}>
              {money(terms.contractAmount)}
            </Text>
          </View>
          <Text style={[styles.body, { marginTop: 4 }]}>
            {terms.paymentTerms
              ? terms.paymentTerms
              : "Payment shall be made in progress payments as mutually agreed, with final payment due upon completion of the Work and any required inspections. Payment is due within fifteen (15) days of each approved invoice."}
          </Text>
        </Article>

        <Article n={8} title="CHANGE ORDERS">
          <Text style={styles.body}>
            Any change to the scope, price, or schedule of the Work must be
            documented in a written change order / addendum signed by both
            Parties before the additional work proceeds. Unforeseen or concealed
            conditions discovered after the Work begins shall be addressed by
            change order.
          </Text>
        </Article>

        <Article n={9} title="SCHEDULE">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Estimated start date</Text>
            <Text style={styles.rowValue}>{fmtDate(terms.startDate)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Estimated completion</Text>
            <Text style={styles.rowValue}>
              {fmtDate(terms.estimatedCompletionDate)}
            </Text>
          </View>
          <Text style={[styles.muted, { marginTop: 4 }]}>
            Dates are estimates. The Labor Contractor is not responsible for
            delays caused by weather, inspections, material availability, or
            other events outside its reasonable control.
          </Text>
        </Article>

        <Article n={10} title="MATERIALS AND EQUIPMENT">
          <Text style={styles.body}>
            Unless expressly stated in the Scope of Work, the Owner shall furnish
            all permanent materials and major equipment. The Labor Contractor
            shall furnish its own hand tools, small tools, and labor consumables.
            The Labor Contractor is not responsible for defects in
            Owner-supplied materials.
          </Text>
        </Article>

        <Article n={11} title="PERMITS / CODE COMPLIANCE">
          <Text style={styles.body}>
            The Work shall comply with applicable building codes. Unless
            otherwise agreed in writing, the Owner is responsible for obtaining
            and paying for required permits. Any work mandated by a building
            official, inspector, or code that is not within the Scope of Work
            shall be treated as a change order.
          </Text>
        </Article>

        <Article n={12} title="INSURANCE / LICENSING">
          <Text style={styles.body}>
            The Labor Contractor represents that it carries the insurance
            required by law for its operations and that it holds the licenses
            required for the Work.
          </Text>
          <View style={[styles.rowLine, { marginTop: 4 }]}>
            <Text style={styles.rowLabel}>Contractor license #</Text>
            <Text style={styles.rowValue}>
              {contractor.license || "On file / as applicable"}
            </Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Insurance</Text>
            <Text style={styles.rowValue}>
              {contractor.insurance || "As required by law"}
            </Text>
          </View>
        </Article>

        <Article n={13} title="INDEPENDENT CONTRACTOR STATUS">
          <Text style={styles.body}>
            The Labor Contractor is an independent contractor and not an
            employee, agent, partner, or joint venturer of the Owner. The Labor
            Contractor is responsible for its own taxes, workers, and the means
            and methods of performing the Work.
          </Text>
        </Article>

        <Article n={14} title="WARRANTY / WORKMANSHIP">
          <Text style={styles.body}>
            The Labor Contractor warrants that the Work will be free from defects
            in workmanship for a period of one (1) year from completion, unless a
            longer period is required by law. The Labor Contractor shall correct
            defective workmanship at no additional labor cost during the warranty
            period. This warranty does not cover Owner-supplied materials,
            ordinary wear, or damage caused by others.
          </Text>
        </Article>

        <Article n={15} title="INDEMNIFICATION">
          <Text style={styles.body}>
            To the fullest extent permitted by law, each Party shall indemnify
            and hold harmless the other Party from claims, damages, and expenses
            arising out of that Party&apos;s own negligence or willful misconduct
            in connection with the Work.
          </Text>
        </Article>

        <Article n={16} title="DEFAULT / TERMINATION">
          <Text style={styles.body}>
            If either Party materially breaches this Agreement and fails to cure
            within ten (10) days of written notice, the non-breaching Party may
            terminate this Agreement. Upon termination, the Labor Contractor
            shall be paid for Work properly performed through the date of
            termination. Non-payment may result in a work stoppage.
          </Text>
        </Article>

        <Article n={17} title="DISPUTE RESOLUTION / GOVERNING LAW">
          <Text style={styles.body}>
            This Agreement is governed by the laws of the State of Florida. The
            Parties shall first attempt to resolve any dispute through good-faith
            negotiation, and thereafter by mediation or binding arbitration in
            the county where the Project is located. The prevailing Party shall
            be entitled to recover reasonable attorney&apos;s fees and costs.
          </Text>
        </Article>

        <Article n={18} title="ENTIRE AGREEMENT">
          <Text style={styles.body}>
            This Agreement, together with any signed change orders or addenda,
            constitutes the entire agreement between the Parties and supersedes
            all prior discussions. It may be amended only by a writing signed by
            both Parties.
          </Text>
        </Article>

        <View wrap={false}>
          <Text style={[styles.articleHeading, { marginTop: 8 }]}>
            SIGNATURES
          </Text>
          <Text style={[styles.body, { marginBottom: 4 }]}>
            By signing below, the Parties agree to the terms of this Agreement.
          </Text>
          <SignatureBlock
            ownerName={ownerName}
            contractorName={contractorName}
          />
        </View>

        <ContractFooter
          company={company}
          rightMeta={`Labor Contract · Job #${job.jobNumber} · v${data.versionNumber}`}
        />
      </Page>
    </Document>
  );
}

export async function renderLaborContractPdf(
  data: LaborContractSnapshot,
): Promise<Buffer> {
  return renderToBuffer(<LaborContractDoc data={data} />);
}
