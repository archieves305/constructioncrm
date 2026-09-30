import { defineTemplate } from "../../../../src/lib/workflows/templates/define";
import { LEGAL_NO_PERMIT_WARNING } from "../../../../src/lib/workflows/templates/types";
import { ACC, CM, NO_PERMIT_TASKS, OA, PC, PM, VIOLATION_BANDS as B, any, task, when } from "./_shorthand";

const FINES = any("fines_accruing", "lien_recorded");

/**
 * Code Violation Case, streamlined: 32 steps, 17–20 on a typical case.
 *
 * Applied ALONE to a CodeViolationCase (kind VIOLATION composes without
 * Core). Every legal gate is kept with its evidence: violation items exist
 * and are complete, management approval, the permit decision and its
 * branch, the linked job and its completion, the agency reinspection, the
 * agency's written confirmation, fines and liens, the manager's approval,
 * and "Close case" itself. What went are the steps that re-entered or
 * re-confirmed the same fact.
 *
 * Construction completion never equals compliance — the agency's written
 * confirmation is a separate, later gate.
 *
 * The nine phase keys, the six toggles and the keys `close_case`,
 * `agency_reinspection` and `determine_permit_requirement` are read by the
 * case page and the engine; they do not change.
 */
export const CODE_VIOLATION = defineTemplate({
  key: "code_violation",
  name: "Code Violation Case",
  kind: "VIOLATION",
  description:
    "Intake through agency-confirmed closure for a municipal or county code violation. Corrective construction runs on the linked job under its own trade workflow.",
  scopeToggles: [
    { key: "construction_required", label: "Corrective construction required", description: "Physical work on the property; runs on a linked job.", default: true },
    { key: "hearing_required", label: "Hearing scheduled or required", default: false },
    { key: "fines_accruing", label: "Fines accruing", description: "A daily fine is running or a fine has been imposed.", default: false },
    { key: "lien_recorded", label: "Lien recorded", default: false },
    { key: "emergency", label: "Emergency / unsafe condition", default: false },
    { key: "appeal", label: "Appeal being filed", default: false },
  ],
  phases: [
    {
      key: "intake",
      name: "Intake and Review",
      band: B.INTAKE,
      tasks: [
        task("assign_case_manager", "Assign case manager", OA, 0, { blocking: true, priority: "HIGH" }),
        task("review_notice", "Review the notice and complete the case record", CM, 1, {
          priority: "HIGH",
          checklist: [
            "Violation notice uploaded to the case",
            "Address, parcel / folio and legal owner match the notice",
            "Jurisdiction, department and agency case number entered",
            "Compliance deadline and any reinspection date entered",
            'Fine terms entered — "Fines accruing" set if so',
            when("hearing_required", "Hearing date entered on the Hearings tab"),
          ],
        }),
        task("create_violation_items", "Create a violation item for every cited violation", CM, 1, {
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "VIOLATION_ITEMS",
          requiredEvidenceParam: "EXISTS",
        }),
        task("contact_code_officer", "Contact the code officer and confirm official status", CM, 2, {
          dependsOn: ["review_notice"],
          checklist: [
            "Officer name, phone and email recorded",
            "Agency status and reinspection expectations noted",
            "Official balance and its date entered on Fines & Liens",
          ],
        }),
      ],
    },
    {
      key: "site_investigation",
      name: "Site Investigation",
      band: B.SITE_INVESTIGATION,
      tasks: [
        task("inspect_site", "Inspect the site and document every item", CM, 3, {
          dependsOn: ["create_violation_items"],
          priority: "HIGH",
          checklist: [
            "Access arranged with the owner / occupant",
            "Before photos uploaded",
            "Field conditions noted on every item",
            "Responsible trade set on every item",
            'Unsafe conditions checked — "Emergency" set on the case if any',
          ],
        }),
        // Ready at once: an unsafe condition does not wait for the inspection chain.
        task("secure_site_emergency", "Secure the site and abate the emergency", CM, 0, {
          condition: any("emergency"),
          blocking: true,
          priority: "URGENT",
        }),
        task("prepare_preliminary_scope_budget", "Permit history, corrective scope and budget", CM, 3, {
          dependsOn: ["inspect_site"],
          checklist: [
            "Permit history searched — unpermitted prior work flagged on the items",
            "Corrective scope written per item",
            "Estimated correction cost entered on the case",
          ],
        }),
      ],
    },
    {
      key: "strategy",
      name: "Strategy and Authorization",
      band: B.STRATEGY,
      tasks: [
        task("decide_strategy", "Decide the strategy: correct, contest, appeal or extend", CM, 1, {
          dependsOn: ["prepare_preliminary_scope_budget"],
          priority: "HIGH",
          checklist: [
            "Option chosen and recorded on the case",
            "Deadline feasibility assessed — extension requested if needed",
            "Need for an attorney, architect or engineer decided",
            '"Appeal" set on the case if appealing',
          ],
        }),
        task("obtain_management_owner_approval", "Management and owner approval of strategy, scope and budget", PM, 2, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          checklist: [
            "Owner approved the strategy in writing",
            "Management approved the strategy",
            when("construction_required", "Proposals obtained or internal crew assigned"),
            when("construction_required", "Corrective scope and budget approved"),
          ],
        }),
        task("file_appeal", "File the appeal and calendar the appeal deadline", CM, 2, {
          dependsOn: ["obtain_management_owner_approval"],
          condition: any("appeal"),
          priority: "HIGH",
          checklist: ["Appeal deadline entered on the case", "Filing receipt saved to the case"],
        }),
        task("determine_permit_requirement", "Determine whether a permit is required for the corrective work", PC, 3, {
          dependsOn: ["decide_strategy"],
          blocking: true,
          priority: "HIGH",
          description: "Set the permit status on the Workflow tab. Completing this step unlocks the permit or no-permit branch.",
          checklist: ["Jurisdiction consulted", "Scope checked against the exemption list", "Decision recorded on the Workflow tab"],
        }),
      ],
    },
    {
      key: "permit_required",
      name: "Permitting",
      band: B.PERMITTING,
      permit: "REQUIRED",
      tasks: [
        task("confirm_permit_submitted", "Permit application submitted on the linked job", PC, 5, {
          dependsOn: ["determine_permit_requirement"],
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "NUMBER",
          checklist: [
            "Permit type confirmed — after-the-fact permit if prior work was unpermitted",
            "Contractor license and insurance accepted",
            "Plans / engineering the agency requires are with the application",
          ],
        }),
        task("confirm_permit_issued", "Confirm permit issued", PC, 10, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "ISSUED",
          checklist: ["Issued permit saved to the case", "First permit inspection scheduled on the job"],
        }),
        task("close_permit", "Confirm the permit is closed / finaled", PC, 5, {
          dependsOn: ["confirm_permit_issued", "corrective_work_complete"],
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "FINAL",
        }),
      ],
    },
    {
      key: "no_permit",
      name: "No Permit Required",
      band: B.PERMITTING,
      permit: "NOT_REQUIRED",
      note: LEGAL_NO_PERMIT_WARNING,
      tasks: NO_PERMIT_TASKS("determine_permit_requirement"),
    },
    {
      key: "corrective_construction",
      name: "Corrective Construction",
      band: B.CORRECTIVE_CONSTRUCTION,
      tasks: [
        task("create_or_link_job", "Create or link the corrective job and apply its workflow", PM, 2, {
          dependsOn: ["obtain_management_owner_approval"],
          blocking: true,
          priority: "HIGH",
          condition: any("construction_required"),
          requiredEvidence: "LINKED_JOB",
          requiredEvidenceParam: "WORKFLOW",
          description:
            "Use Create job / Link job on the case header, then apply Roofing, Interior Renovation or Doors & Windows on the job's Workflow tab. Scope, materials, crews, scheduling and permit inspections are tracked there, not here.",
          checklist: ["Violation items linked to the job", "Start date set on the job"],
        }),
        task("corrective_work_complete", "Corrective work complete on the linked job", PM, 5, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          condition: any("construction_required"),
          requiredEvidence: "LINKED_JOB",
          requiredEvidenceParam: "COMPLETE",
          description:
            "Becomes completable when the linked job's workflow completes or the job reaches a closed stage. Completing it does NOT mean the violation is resolved — the agency still has to confirm.",
        }),
      ],
    },
    {
      key: "agency_compliance",
      name: "Agency Compliance",
      band: B.AGENCY_COMPLIANCE,
      tasks: [
        task("submit_proof_of_correction", "Submit proof of correction and request reinspection", CM, -5, {
          anchor: "COMPLIANCE_DEADLINE",
          dependsOn: ["corrective_work_complete"],
          priority: "HIGH",
          checklist: [
            "Every item set to Corrected with an after photo",
            "Code officer notified",
            "Proof of correction submitted to the agency",
            "Reinspection requested, confirmation number noted",
            "Reinspection date and attendee on the Inspections tab",
          ],
        }),
        task("agency_reinspection", "Attend the agency reinspection and record the result", CM, 3, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
        }),
        task("obtain_written_compliance_confirmation", "Obtain written compliance confirmation from the agency", CM, 3, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "AGENCY_CONFIRMATION",
          checklist: ["Agency inspection report saved to the case", "Official compliance date entered"],
        }),
        task("confirm_fines_stopped", "Confirm fines have stopped accruing", ACC, 2, {
          dependsOn: ["^"],
          condition: any("fines_accruing"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "STOPPED",
        }),
      ],
    },
    {
      key: "hearings_fines_liens",
      name: "Hearings, Fines and Liens",
      band: B.HEARINGS_FINES_LIENS,
      tasks: [
        // Ready at once: hearing preparation counts back from the hearing
        // date, not forward from an approval.
        task("prepare_hearing_evidence", "Prepare for the hearing", CM, -3, {
          anchor: "HEARING_DATE",
          condition: any("hearing_required"),
          priority: "HIGH",
          checklist: [
            "Hearing date, location / link and notice on the Hearings tab",
            "Attendee assigned — attorney needed?",
            "Evidence package assembled (photos, permits, inspection reports, proof of correction, timeline)",
            when("fines_accruing", "Fine-mitigation argument prepared"),
          ],
        }),
        task("record_hearing_outcome", "Attend the hearing and record the outcome", CM, 1, {
          anchor: "HEARING_DATE",
          dependsOn: ["^"],
          condition: any("hearing_required"),
          requiredEvidence: "HEARING_RESULT",
          checklist: ["Hearing order saved to the case", "Deadlines set by the order entered (compliance, payment, appeal)"],
        }),
        task("confirm_official_balance", "Confirm the official fine balance with the agency", ACC, 2, {
          condition: FINES,
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "OFFICIAL_BALANCE",
        }),
        task("obtain_payment_approval", "Approve payment of fines and costs", PM, 10, {
          dependsOn: ["^"],
          blocking: true,
          condition: FINES,
          checklist: ["Mitigation / reduction requested, or decided against", "Mitigation decision and amount recorded", "Amount to pay approved"],
        }),
        task("record_fine_payment", "Record the fine payment", ACC, 2, {
          dependsOn: ["^"],
          condition: FINES,
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "PAID",
          checklist: ["Receipt saved to the case"],
        }),
        task("obtain_lien_release", "Obtain and record the lien release", ACC, 5, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          condition: any("lien_recorded"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "LIEN_RELEASED",
          checklist: ["Lien amount and recording information entered", "Release / satisfaction recorded"],
        }),
      ],
    },
    {
      key: "closure",
      name: "Closure",
      band: B.CLOSURE,
      tasks: [
        task("confirm_all_items_complete", "Confirm every violation item is complete", CM, 1, {
          dependsOn: ["obtain_written_compliance_confirmation"],
          blocking: true,
          requiredEvidence: "VIOLATION_ITEMS",
          requiredEvidenceParam: "COMPLETE",
          checklist: ["Correction tasks closed", "Linked job workflow complete, or no job required"],
        }),
        task("confirm_fines_liens_resolved", "Confirm fines and liens are resolved", ACC, 2, {
          dependsOn: ["obtain_written_compliance_confirmation"],
          condition: FINES,
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "RESOLVED",
        }),
        task("obtain_manager_close_approval", "Manager approval to close the case", PM, 1, {
          dependsOn: ["confirm_all_items_complete", "confirm_fines_liens_resolved", "close_permit"],
          blocking: true,
          priority: "HIGH",
          checklist: ["Final costs entered on the case (correction, administrative, fines paid)", "Closeout package saved to the case"],
        }),
        task("close_case", "Close case", CM, 0, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "AGENCY_CONFIRMATION",
        }),
      ],
    },
  ],
});
