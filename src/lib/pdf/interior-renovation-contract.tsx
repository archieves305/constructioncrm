import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type {
  ContractTaskSnapshot,
  InteriorRenovationContractSnapshot,
} from "@/lib/contracts/types";
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

const t = StyleSheet.create({
  table: { marginTop: 4 },
  headRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#0f766e",
    paddingBottom: 3,
    fontSize: 8,
    fontWeight: 700,
    textTransform: "uppercase",
    color: "#0f766e",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    fontSize: 9,
  },
  cNum: { width: 16 },
  cTask: { flex: 2.2 },
  cDesc: { flex: 2.6 },
  cAmt: { flex: 1.1, textAlign: "right" },
  cPct: { width: 30, textAlign: "right" },
  cInsp: { width: 42, textAlign: "center" },
  cStatus: { width: 60, textAlign: "center" },
  taskRoom: { color: "#6b7280", fontSize: 8 },
});

const COVERED_TRADES = [
  "Electrical",
  "Window replacement",
  "Door replacement",
  "Framing",
  "Drywall",
  "Interior bedroom remodels",
  "Bathroom remodels",
  "Flooring",
  "Trim / baseboards",
  "Painting",
  "Cabinetry",
  "General interior repair and remodeling",
];

export const INTERIOR_CONDITIONS = [
  "Existing conditions: Interior renovation may involve concealed or unknown conditions. Contractor shall notify Owner before performing extra work arising from concealed conditions.",
  "Protection of existing property: Contractor shall protect floors, walls, fixtures, windows, doors, cabinets, appliances, HVAC equipment, and personal property.",
  "Dust and debris control: Contractor shall use reasonable dust protection, masking, floor covering, and debris removal.",
  "Electrical work: Any electrical work shall comply with code and be performed by properly licensed persons where required.",
  "Plumbing work: Any plumbing work shall comply with code and be performed by properly licensed persons where required.",
  "Structural / framing work: No structural framing, wall removal, beam installation, or load-bearing modification may occur without written approval and required permits.",
  "Windows and doors: Window and door replacement shall be installed plumb, level, weather-tight, secured, and flashed/sealed where applicable, per manufacturer requirements and code.",
  "Bathrooms / wet areas: Shower, tub, waterproofing, tile, plumbing, and wet-area work shall use proper waterproofing and industry-standard installation methods.",
  "Flooring: Flooring installation shall include proper substrate preparation, leveling where required, transitions, cuts, and cleanup.",
  "Paint and finish work: Paint and finish work shall be free from unreasonable visible defects, overspray, drips, incomplete coverage, and damage to adjacent areas.",
];

// Key clauses exported so they can be asserted in tests and reused verbatim.
export const WEEKLY_PAYMENT_CLAUSE =
  "Contractor shall be compensated through weekly progress payments based solely upon work completed, visually inspected, and approved by Owner or Owner's representative. No advance payments shall be required unless expressly approved in writing.";

export const DIRECT_PAYMENT_CLAUSE =
  "Owner shall have the right, but not the obligation, to pay laborers, installers, crew members, subcontractors, or lower-tier labor providers directly. Any such payment shall be credited against sums otherwise due to Contractor under this Agreement.";

export const VISUAL_INSPECTION_CLAUSE =
  "All work shall be subject to visual inspection and approval by Owner or Owner's representative. Payment shall not be due for any task, phase, or milestone until the applicable work has been inspected and accepted.";

export const retainageClause = (pct: number): string =>
  `Owner shall retain ${pct}% of all sums otherwise due under this Agreement. Retainage shall be withheld from each weekly progress payment and shall not be released until final completion of the Project and satisfaction of all retainage release conditions.`;

export const WARRANTY_CLAUSE =
  "Contractor warrants that all labor and workmanship shall be performed in a good, workmanlike manner and shall be free from defects for a period of two (2) years following substantial completion unless a longer period is required by law or separately agreed in writing.";

export const RETAINAGE_RELEASE = [
  "All work is fully completed",
  "Final inspection has occurred",
  "Punch list is complete",
  "All defective work has been corrected",
  "All laborers have been paid",
  "Final lien waivers have been delivered",
  "All cleanup is complete",
  "No unresolved claims remain",
  "No unresolved change orders remain",
  "Warranty documents, if any, have been delivered",
];

const BACKCHARGE_ITEMS = [
  "Rework",
  "Defective work",
  "Failed inspections",
  "Cleanup",
  "Damage to materials",
  "Damage to property",
  "Missed schedule",
  "Safety violations",
  "Unpaid labor claims",
  "Unauthorized work",
  "Additional supervision caused by Contractor default",
];

const TERMINATION_CAUSE = [
  "Poor workmanship",
  "Failure to maintain crew",
  "Safety violations",
  "Abandonment",
  "Failure to follow schedule",
  "Failed inspections",
  "Failure to correct defective work",
  "Unauthorized change orders",
  "Damage to property",
  "Failure to pay laborers",
];

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((it, i) => (
        <Text key={i} style={styles.bullet}>
          • {it}
        </Text>
      ))}
    </>
  );
}

function statusLabel(s: string): string {
  return s.replace(/_/g, " ").toLowerCase();
}

function TaskSchedule({ tasks }: { tasks: ContractTaskSnapshot[] }) {
  if (tasks.length === 0) {
    return (
      <Text style={styles.muted}>
        No detailed task schedule entered. Work shall proceed per the scope of
        work above, subject to weekly inspection and approval.
      </Text>
    );
  }
  return (
    <View style={t.table}>
      <View style={t.headRow}>
        <Text style={t.cNum}>#</Text>
        <Text style={t.cTask}>Task / Room</Text>
        <Text style={t.cDesc}>Description</Text>
        <Text style={t.cAmt}>Amount</Text>
        <Text style={t.cPct}>%</Text>
        <Text style={t.cInsp}>Insp.</Text>
        <Text style={t.cStatus}>Status</Text>
      </View>
      {tasks.map((task, i) => (
        <View key={i} style={t.row} wrap={false}>
          <Text style={t.cNum}>{i + 1}</Text>
          <View style={t.cTask}>
            <Text>{task.name}</Text>
            {task.room ? <Text style={t.taskRoom}>{task.room}</Text> : null}
          </View>
          <Text style={t.cDesc}>{task.description || "—"}</Text>
          <Text style={t.cAmt}>
            {task.paymentAmount != null ? money(task.paymentAmount) : "—"}
          </Text>
          <Text style={t.cPct}>
            {task.paymentPercent != null ? `${task.paymentPercent}%` : "—"}
          </Text>
          <Text style={t.cInsp}>
            {task.inspectionRequired ? task.inspectionStatus : "N/A"}
          </Text>
          <Text style={t.cStatus}>{statusLabel(task.status)}</Text>
        </View>
      ))}
    </View>
  );
}

function InteriorRenovationDoc({
  data,
}: {
  data: InteriorRenovationContractSnapshot;
}) {
  const { company, job, owner, contractor, jobSite, terms } = data;
  const ownerName = owner.companyName || owner.name;
  const contractorName = contractor.companyName || contractor.name;
  const generated = new Date(data.generatedAt);
  const retPct = terms.retainagePercent;
  const delay = terms.delayDamagesPerDay;

  return (
    <Document
      title={`Interior Renovation Labor Contract — ${job.jobNumber} — ${contractor.name}`}
      author={company.name}
    >
      <Page size="LETTER" style={styles.page}>
        <DocHeader
          company={company}
          docLabel="INTERIOR RENOVATION LABOR CONTRACT"
          metaLines={[
            `Job #${job.jobNumber}`,
            `Version ${data.versionNumber}`,
            `Contract date ${generated.toLocaleDateString("en-US")}`,
          ]}
        />

        <Text style={styles.title}>
          GENERAL INTERIOR RENOVATION LABOR AGREEMENT
        </Text>
        <Text style={styles.subtitle}>{job.title}</Text>

        <Text style={styles.intro}>
          This General Interior Renovation Labor Agreement (the
          &quot;Agreement&quot;) is made as of {fmtDate(data.generatedAt)} between{" "}
          <Text style={styles.bold}>{ownerName}</Text> (&quot;Owner&quot;) and{" "}
          <Text style={styles.bold}>{contractorName}</Text> (&quot;Contractor&quot;
          or &quot;Labor Contractor&quot;). This Agreement is between the Owner
          and the Contractor; {company.name} acts only as the business and system
          generating and managing this document unless the Project data shows
          otherwise.
        </Text>

        <Article n={1} title="PARTIES">
          <View style={styles.partyGrid}>
            <PartyColumn heading="Owner / Customer" party={owner} address={jobSite} />
            <PartyColumn heading="Labor Contractor" party={contractor} />
          </View>
          {contractor.insurance ? (
            <Text style={styles.muted}>
              Contractor insurance: {contractor.insurance}
            </Text>
          ) : null}
        </Article>

        <Article n={2} title="PROJECT / JOB SITE">
          <Text style={styles.bold}>{addressOneLine(jobSite)}</Text>
          <View style={[styles.rowLine, { marginTop: 4 }]}>
            <Text style={styles.rowLabel}>Job name</Text>
            <Text style={styles.rowValue}>{job.title}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Job number</Text>
            <Text style={styles.rowValue}>{job.jobNumber}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Project / service type</Text>
            <Text style={styles.rowValue}>{job.serviceType}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Contract date</Text>
            <Text style={styles.rowValue}>{fmtDate(data.generatedAt)}</Text>
          </View>
        </Article>

        <Article n={3} title="JOB TYPE">
          <Text style={styles.body}>
            This Agreement is issued under a{" "}
            <Text style={styles.bold}>{job.jobTypeLabel}</Text> job arrangement.
            Contractor&apos;s compensation is governed by the payment terms below
            regardless of the Owner&apos;s underlying job type.
          </Text>
        </Article>

        <Article n={4} title="GENERAL INTERIOR RENOVATION SCOPE">
          <Text style={styles.body}>
            Contractor shall furnish all labor, supervision, and workmanship for
            general interior renovation work, which may include, without
            limitation: {COVERED_TRADES.join(", ")}.
          </Text>
          <Text style={[styles.bold, { marginTop: 4 }]}>
            Scope of work (as entered):
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
          {terms.notes ? (
            <View style={{ marginTop: 6 }}>
              <Text style={styles.bold}>Notes:</Text>
              <Text>{terms.notes}</Text>
            </View>
          ) : null}
          <Text style={[styles.bold, { marginTop: 6 }]}>
            Interior renovation conditions:
          </Text>
          {INTERIOR_CONDITIONS.map((c, i) => (
            <Text key={i} style={styles.bullet} wrap={false}>
              {i + 1}. {c}
            </Text>
          ))}
        </Article>

        <Article n={5} title="DETAILED TASK SCHEDULE">
          <Text style={styles.body}>
            The following task and payment schedule applies to the Work. Payment
            for each task is due only after the task is completed, visually
            inspected, and approved.
          </Text>
          <TaskSchedule tasks={data.tasks} />
        </Article>

        <Article n={6} title="CONTRACTOR RESPONSIBILITIES">
          <Bullets
            items={[
              "Perform the Work in a good and workmanlike manner consistent with industry standards and applicable code.",
              "Supply all labor, supervision, tools, and small consumables required to complete the Work unless stated otherwise.",
              "Maintain adequate manpower and diligently prosecute the Work to completion.",
              "Coordinate scheduling, inspections, and progress with Owner or Owner's representative.",
              "Notify Owner of concealed or unforeseen conditions before performing extra work.",
            ]}
          />
        </Article>

        <Article n={7} title="OWNER RESPONSIBILITIES">
          <Bullets
            items={[
              "Provide timely access to the job site and work areas.",
              "Make weekly payments for completed, inspected, and approved work per the terms below.",
              "Furnish materials and equipment except those Contractor has agreed to provide.",
              "Conduct or arrange visual inspections of completed work.",
            ]}
          />
        </Article>

        <Article n={8} title="WEEKLY PAYMENT TERMS">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Total labor amount</Text>
            <Text style={[styles.rowValue, styles.bold]}>
              {money(terms.contractAmount)}
            </Text>
          </View>
          {terms.paymentTerms ? (
            <Text style={[styles.body, { marginTop: 4 }]}>
              {terms.paymentTerms}
            </Text>
          ) : null}
          <Text style={[styles.body, { marginTop: 4 }]}>
            {WEEKLY_PAYMENT_CLAUSE}
          </Text>
          <Text style={[styles.bold, { marginTop: 6 }]}>
            Weekly payment calculation:
          </Text>
          <Bullets
            items={[
              "Gross approved amount (tasks completed, inspected, and approved that week)",
              `Less ${retPct}% retainage`,
              "Less backcharges and offsets",
              "Less any direct payments made to laborers",
              "Equals net amount due to Contractor",
            ]}
          />
        </Article>

        <Article n={9} title="DIRECT PAYMENT OF LABORERS">
          <Text style={styles.body}>{DIRECT_PAYMENT_CLAUSE}</Text>
        </Article>

        <Article n={10} title="VISUAL INSPECTION BEFORE PAYMENT">
          <Text style={styles.body}>{VISUAL_INSPECTION_CLAUSE}</Text>
        </Article>

        <Article n={11} title={`${retPct}% RETAINAGE`}>
          <Text style={styles.body}>{retainageClause(retPct)}</Text>
        </Article>

        <Article n={12} title="RETAINAGE RELEASE CONDITIONS">
          <Text style={styles.body}>
            Retainage shall be released only after all of the following
            conditions are satisfied:
          </Text>
          <Bullets items={RETAINAGE_RELEASE} />
        </Article>

        <Article n={13} title="CHANGE ORDERS">
          <Text style={styles.body}>
            Contractor shall not be entitled to compensation for additional work,
            extra work, changed conditions, or added scope unless approved through
            a written Change Order signed by Owner before the additional work
            begins.
          </Text>
        </Article>

        <Article n={14} title="NO VERBAL EXTRAS">
          <Text style={styles.body}>
            No verbal instruction, request, or representation shall create any
            obligation to pay for extra work. No change order, extra work, or
            added scope is valid unless approved in writing before the work
            begins.
          </Text>
        </Article>

        <Article n={15} title="SCHEDULE AND TIME OF PERFORMANCE">
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Start date</Text>
            <Text style={styles.rowValue}>{fmtDate(terms.startDate)}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={styles.rowLabel}>Estimated completion</Text>
            <Text style={styles.rowValue}>
              {fmtDate(terms.estimatedCompletionDate)}
            </Text>
          </View>
          <Text style={[styles.body, { marginTop: 4 }]}>
            Time is of the essence. Contractor shall maintain adequate manpower
            and diligently prosecute the Work to completion. If Contractor delays
            the Project beyond the agreed completion date without an
            Owner-approved extension, Owner may assess delay damages of{" "}
            {money(delay)} per day as a reasonable estimate of damages.
          </Text>
        </Article>

        <Article n={16} title="MATERIALS AND EQUIPMENT">
          <Text style={styles.body}>
            Unless expressly stated in the scope of work, Owner shall furnish all
            permanent materials and major equipment. Contractor shall furnish its
            own hand tools, small tools, and labor consumables, and is not
            responsible for defects in Owner-supplied materials.
          </Text>
        </Article>

        <Article n={17} title="PERMITS, CODE COMPLIANCE, AND INSPECTIONS">
          <Text style={styles.body}>
            The Work shall comply with all applicable building codes. Unless
            otherwise agreed in writing, Owner is responsible for obtaining and
            paying for required permits. Contractor shall coordinate and support
            required inspections. Work mandated by a building official, inspector,
            or code that is not within the scope of work shall be treated as a
            change order.
          </Text>
        </Article>

        <Article
          n={18}
          title="ELECTRICAL / PLUMBING / STRUCTURAL WORK DISCLAIMER"
        >
          <Text style={styles.body}>
            Any electrical, plumbing, mechanical, or structural / load-bearing
            work shall comply with code and be performed by properly licensed
            persons where required by law. No structural modification, wall
            removal, or load-bearing change may occur without written approval and
            required permits. Contractor is responsible for ensuring its workers
            hold the licenses required for the trades they perform.
          </Text>
        </Article>

        <Article n={19} title="WORKMANSHIP STANDARDS">
          <Text style={styles.body}>
            All Work shall be performed in a good, workmanlike manner consistent
            with industry standards, manufacturer requirements, and applicable
            code, and shall be free from unreasonable visible defects.
          </Text>
        </Article>

        <Article n={20} title="WARRANTY">
          <Text style={styles.body}>{WARRANTY_CLAUSE}</Text>
        </Article>

        <Article n={21} title="CLEANUP">
          <Text style={styles.body}>
            Contractor shall maintain a clean and safe jobsite, remove debris
            daily, and protect existing finishes, flooring, windows, doors,
            fixtures, landscaping, and personal property. Owner may arrange
            cleanup or protection work and backcharge Contractor if Contractor
            fails to comply.
          </Text>
        </Article>

        <Article n={22} title="SAFETY AND OSHA COMPLIANCE">
          <Text style={styles.body}>
            Contractor shall be solely responsible for jobsite safety, OSHA
            compliance, fall protection, electrical safety, tool safety, personal
            protective equipment, and supervision of its crew.
          </Text>
        </Article>

        <Article n={23} title="PHOTOS AND DOCUMENTATION">
          <Text style={styles.body}>
            Contractor shall provide progress photographs upon request and before
            requesting milestone approval or payment.
          </Text>
        </Article>

        <Article n={24} title="BACKCHARGES AND OFFSETS">
          <Text style={styles.body}>
            Owner may deduct from amounts otherwise due to Contractor the costs
            arising from, without limitation:
          </Text>
          <Bullets items={BACKCHARGE_ITEMS} />
        </Article>

        <Article n={25} title="RIGHT TO SUPPLEMENT WORKFORCE">
          <Text style={styles.body}>
            If Contractor fails to maintain sufficient manpower, meet schedule
            requirements, correct defective work, or diligently prosecute the
            Work, Owner may furnish additional labor, subcontractors, or vendors
            and deduct associated costs from amounts otherwise due to Contractor.
          </Text>
        </Article>

        <Article n={26} title="TERMINATION FOR CONVENIENCE">
          <Text style={styles.body}>
            Owner may terminate this Agreement at any time for convenience upon
            written notice. Contractor shall be paid only for approved work
            completed through the date of termination, less retainage,
            backcharges, offsets, and prior payments.
          </Text>
        </Article>

        <Article n={27} title="TERMINATION FOR CAUSE">
          <Text style={styles.body}>
            Owner may terminate this Agreement immediately for cause, including:
          </Text>
          <Bullets items={TERMINATION_CAUSE} />
        </Article>

        <Article n={28} title="INDEPENDENT CONTRACTOR STATUS">
          <Text style={styles.body}>
            Contractor is an independent contractor and not an employee of Owner.
            Contractor shall be solely responsible for payroll taxes, workers&apos;
            compensation obligations, employment-related liabilities, supervision,
            and control of its workers, except to the extent Owner elects to make
            direct payments as a credit against the contract amount.
          </Text>
        </Article>

        <Article n={29} title="INSURANCE AND LICENSING">
          <Text style={styles.body}>
            Contractor represents that it carries the insurance required by law
            for its operations and holds the licenses required for the Work.
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

        <Article n={30} title="LIEN WAIVERS">
          <Text style={styles.body}>
            Final payment and release of retainage shall not be due until
            Contractor delivers final lien waivers and releases from Contractor
            and, upon request, from all laborers, subcontractors, suppliers, and
            lower-tier providers involved in the Project. Owner may withhold
            payment for incomplete, defective, nonconforming, or unapproved work
            until such deficiencies are corrected to Owner&apos;s satisfaction.
          </Text>
        </Article>

        <Article n={31} title="INDEMNIFICATION">
          <Text style={styles.body}>
            To the fullest extent permitted by law, each Party shall indemnify and
            hold harmless the other Party from claims, damages, and expenses
            arising out of that Party&apos;s own negligence or willful misconduct in
            connection with the Work.
          </Text>
        </Article>

        <Article n={32} title="DISPUTE RESOLUTION">
          <Text style={styles.body}>
            The Parties shall first attempt to resolve any dispute through
            good-faith negotiation, and thereafter by mediation or binding
            arbitration in the county where the Project is located. The prevailing
            Party shall be entitled to recover reasonable attorney&apos;s fees and
            costs.
          </Text>
        </Article>

        <Article n={33} title="GOVERNING LAW">
          <Text style={styles.body}>
            This Agreement is governed by the laws of the State of Florida.
          </Text>
        </Article>

        <Article n={34} title="ENTIRE AGREEMENT">
          <Text style={styles.body}>
            This Agreement, together with any signed change orders or addenda,
            constitutes the entire agreement between the Parties and supersedes all
            prior discussions. It may be amended only by a writing signed by both
            Parties.
          </Text>
        </Article>

        <View wrap={false}>
          <Text style={[styles.articleHeading, { marginTop: 8 }]}>
            35. SIGNATURE BLOCKS
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
          rightMeta={`Interior Renovation Labor Contract · Job #${job.jobNumber} · v${data.versionNumber}`}
        />
      </Page>
    </Document>
  );
}

export async function renderInteriorRenovationContractPdf(
  data: InteriorRenovationContractSnapshot,
): Promise<Buffer> {
  return renderToBuffer(<InteriorRenovationDoc data={data} />);
}
