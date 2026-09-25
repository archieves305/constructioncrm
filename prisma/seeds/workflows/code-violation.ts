import { defineTemplate } from "../../../src/lib/workflows/templates/define";
import { LEGAL_NO_PERMIT_WARNING } from "../../../src/lib/workflows/templates/types";
import { ACC, CM, EST, NO_PERMIT_TASKS, OA, PC, PM, REQ, SUP, VIOLATION_BANDS as B, all, any, task, when } from "./_shorthand";

/**
 * Code Violation Case — the default workflow for a municipal or county code
 * violation, intake through agency-confirmed closure.
 *
 * Applied ALONE to a CodeViolationCase (kind VIOLATION composes without
 * Core). Corrective construction is deliberately THIN here: it runs on the
 * linked Job under Core + the trade template (Roofing, Interior Renovation,
 * Doors & Windows), and this template only tracks that a job exists, has
 * its workflow, and finished. Construction completion never equals
 * compliance — Phase 6 (agency reinspection and written confirmation) is a
 * separate, later gate, and "Close case" cannot be completed without the
 * agency's confirmation on file.
 *
 * Branching: the permit decision is the enum branch (same legal warning as
 * a job); everything else is a scope toggle set from the intake answers.
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
    // ── Phase 1 — Intake and Review ────────────────────────────────────
    {
      key: "intake",
      name: "Intake and Review",
      band: B.INTAKE,
      tasks: [
        task("upload_review_notice", "Upload and review the violation notice", CM, 1, {
          anchor: "JOB_CREATED",
          priority: "HIGH",
          requiredEvidence: "ATTACHMENT",
        }),
        task("confirm_property_case_details", "Confirm property, parcel, owner, jurisdiction and agency case number", CM, 1, {
          dependsOn: ["^"],
          checklist: ["Address matches the notice", "Parcel / folio number", "Legal owner name", "Jurisdiction and department", "Agency case / citation number"],
        }),
        task("create_violation_items", "Create a violation item for every cited violation", CM, 1, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "VIOLATION_ITEMS",
          requiredEvidenceParam: "EXISTS",
        }),
        task("confirm_deadlines_inspections_hearings", "Confirm compliance deadline, inspection and hearing dates", CM, 1, {
          dependsOn: ["^"],
          priority: "HIGH",
          checklist: [
            "Original compliance deadline entered",
            "Current compliance deadline entered",
            "Reinspection date, if stated",
            when("hearing_required", "Hearing date entered on the Hearings tab"),
          ],
        }),
        task("determine_fine_accrual", "Determine whether fines are accruing and record the fine terms", CM, 1, {
          dependsOn: ["^"],
          checklist: ["Initial fine", "Daily fine", "Accrual start date", '"Fines accruing" set on the case'],
        }),
        task("assign_case_manager", "Assign case manager", OA, 0, {
          anchor: "JOB_CREATED",
          blocking: true,
          priority: "HIGH",
          description: "Set the case manager on the case header; every Case-manager step reassigns to them.",
        }),
        task("contact_code_officer", "Contact the code enforcement officer", CM, 2, {
          dependsOn: ["confirm_property_case_details"],
          requiredEvidence: "NOTE",
          checklist: ["Officer name, phone and email recorded", "Current agency status", "Reinspection expectations"],
        }),
        task("confirm_official_status_balance", "Confirm official case status and balance with the agency", CM, 2, {
          dependsOn: ["^"],
          requiredEvidence: "NOTE",
          description: "Enter the official balance and its date on Fines & Liens. It is always shown separately from the system estimate.",
        }),
      ],
    },

    // ── Phase 2 — Site Investigation ───────────────────────────────────
    {
      key: "site_investigation",
      name: "Site Investigation",
      band: B.SITE_INVESTIGATION,
      startsAfter: ["create_violation_items"],
      tasks: [
        task("schedule_site_access_inspection", "Schedule site access and internal inspection", SUP, 1, {
          priority: "HIGH",
          checklist: ["Owner / occupant contacted", "Access date confirmed", "Keys, gate codes, restrictions"],
        }),
        task("conduct_site_inspection", "Conduct internal site inspection", SUP, 2, { dependsOn: ["^"], requiredEvidence: "NOTE" }),
        task("upload_before_photos", "Upload before photographs", SUP, 0, { dependsOn: ["^"], requiredEvidence: "PHOTO" }),
        task("document_each_item", "Document field conditions for every violation item", SUP, 1, {
          dependsOn: ["^"],
          requiredEvidence: "NOTE",
          description: "Add a note or photo on each violation item.",
        }),
        task("identify_responsible_trades", "Identify the responsible trade for each item", CM, 1, {
          dependsOn: ["^"],
          checklist: ["Trade set on every item", "Internal crew vs subcontractor"],
        }),
        task("identify_emergency_conditions", "Identify emergency or unsafe conditions", SUP, 0, {
          dependsOn: ["conduct_site_inspection"],
          priority: "URGENT",
          checklist: ["Structural hazards", "Electrical / fire hazards", "Occupant safety", '"Emergency" set on the case if any'],
        }),
        task("secure_site_emergency", "Secure the site and abate the emergency condition", SUP, 0, {
          dependsOn: ["^"],
          condition: any("emergency"),
          blocking: true,
          priority: "URGENT",
          requiredEvidence: "PHOTO",
        }),
        task("determine_prior_unpermitted_work", "Determine whether prior work was performed without a permit", PC, 2, {
          dependsOn: ["conduct_site_inspection"],
          requiredEvidence: "NOTE",
          checklist: ["Permit history searched on the jurisdiction portal", "Findings recorded", "Affected items flagged as unpermitted"],
        }),
        task("prepare_preliminary_scope_budget", "Prepare preliminary corrective scope and budget", EST, 3, {
          dependsOn: ["document_each_item", "identify_responsible_trades", "determine_prior_unpermitted_work"],
          requiredEvidence: "ATTACHMENT",
          description: "Enter the estimated correction cost on the case.",
        }),
      ],
    },

    // ── Phase 3 — Strategy and Authorization ───────────────────────────
    {
      key: "strategy",
      name: "Strategy and Authorization",
      band: B.STRATEGY,
      startsAfter: ["prepare_preliminary_scope_budget"],
      tasks: [
        task("decide_strategy", "Decide whether to correct, contest, appeal or request an extension", CM, 1, {
          priority: "HIGH",
          requiredEvidence: "NOTE",
          checklist: ["Option chosen and recorded", "Deadline feasibility assessed", '"Appeal" set on the case if appealing'],
        }),
        task("obtain_management_owner_approval", "Obtain management and owner approval of the strategy", PM, 2, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "ATTACHMENT",
        }),
        task("request_document_extension", "Request and document a compliance-deadline extension", CM, -10, {
          dependsOn: ["decide_strategy"],
          anchor: "COMPLIANCE_DEADLINE",
          requiredEvidence: "NOTE",
          description:
            "Skip with a reason if no extension is sought. Record the request on the case; approving it moves the current deadline and previews every dependent task date.",
        }),
        task("file_appeal", "File the appeal and calendar the appeal deadline", CM, 2, {
          dependsOn: ["obtain_management_owner_approval"],
          condition: any("appeal"),
          priority: "HIGH",
          requiredEvidence: "ATTACHMENT",
          checklist: ["Appeal deadline entered on the case", "Filing receipt attached"],
        }),
        task("determine_permit_requirement", "Determine whether a permit is required for the corrective work", PC, 3, {
          dependsOn: ["decide_strategy"],
          blocking: true,
          priority: "HIGH",
          description: "Set the permit status on the Workflow tab. Completing this step unlocks the permit or no-permit branch.",
          checklist: ["Jurisdiction consulted", "Scope checked against exemption list", "Decision recorded on the Workflow tab"],
        }),
        task("obtain_proposals_or_assign_crews", "Obtain contractor proposals or assign internal crews", PM, 3, {
          dependsOn: ["obtain_management_owner_approval"],
          condition: any("construction_required"),
          requiredEvidence: "ATTACHMENT",
        }),
        task("approve_scope_budget", "Approve corrective scope and budget", PM, 1, {
          dependsOn: ["^"],
          blocking: true,
          condition: any("construction_required"),
          requiredEvidence: "ATTACHMENT",
        }),
        task("determine_professional_assistance", "Determine whether legal, architectural or engineering assistance is required", CM, 1, {
          dependsOn: ["obtain_management_owner_approval"],
          checklist: ["Attorney", "Architect", "Engineer", "None required"],
        }),
      ],
    },

    // ── Phase 4 — Permitting (permit-required branch) ──────────────────
    // The permit itself lives on the linked Job (JobPermit); these are the
    // case's oversight steps, not the trade's application steps.
    {
      key: "permit_required",
      name: "Permitting",
      band: B.PERMITTING,
      permit: "REQUIRED",
      startsAfter: ["determine_permit_requirement"],
      tasks: [
        task("confirm_permit_jurisdiction", "Confirm permitting jurisdiction and permit type for the corrective work", PC, 1, {
          checklist: ["City vs unincorporated county", "Permit type(s)", "After-the-fact permit required"],
        }),
        task("confirm_licensing_insurance", "Confirm contractor licensing and insurance for the permit", PC, 1, { dependsOn: ["^"], requiredEvidence: "ATTACHMENT" }),
        task("obtain_plans_engineering_approvals", "Obtain plans, engineering and product approvals required by the agency", PC, 3, {
          dependsOn: ["^"],
          requiredEvidence: "ATTACHMENT",
          description: "When a trade workflow runs on the linked job, its permit phase gathers these; attach or reference them here.",
        }),
        task("confirm_permit_submitted", "Confirm the permit application is submitted on the linked job", PC, 2, {
          dependsOn: ["^"],
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "NUMBER",
        }),
        task("track_permit_comments", "Track permit comments and corrections", PC, 5, { dependsOn: ["^"] }),
        task("confirm_permit_issued", "Confirm permit issued", PC, 5, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "ISSUED",
        }),
        task("upload_permit_to_case", "Upload the issued permit to the case", PC, 1, { dependsOn: ["^"], requiredEvidence: "ATTACHMENT" }),
        task("confirm_permit_inspections_scheduled", "Confirm required permit inspections are scheduled", PC, 2, {
          dependsOn: ["^"],
          checklist: ["Inspection sequence understood", "First inspection scheduled on the job"],
        }),
        task("close_permit", "Confirm the permit is closed / finaled", PC, 5, {
          dependsOn: ["confirm_permit_inspections_scheduled", "corrective_work_complete"],
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "FINAL",
        }),
      ],
    },
    // ── Phase 4 — No permit required ───────────────────────────────────
    {
      key: "no_permit",
      name: "No Permit Required",
      band: B.PERMITTING,
      permit: "NOT_REQUIRED",
      note: LEGAL_NO_PERMIT_WARNING,
      startsAfter: ["determine_permit_requirement"],
      tasks: NO_PERMIT_TASKS("Verify and document that no permit is required for the corrective work"),
    },

    // ── Phase 5 — Corrective Construction (thin; the work runs on the job) ──
    {
      key: "corrective_construction",
      name: "Corrective Construction",
      band: B.CORRECTIVE_CONSTRUCTION,
      startsAfter: ["approve_scope_budget"],
      tasks: [
        task("create_or_link_job", "Create or link the corrective construction job", PM, 1, {
          blocking: true,
          priority: "HIGH",
          condition: any("construction_required"),
          requiredEvidence: "LINKED_JOB",
          requiredEvidenceParam: "EXISTS",
          description: "Use Create job / Link job on the case header. The job runs its own Core + trade workflow; this case tracks only the gate below.",
        }),
        task("apply_trade_workflow_on_job", "Apply the Core + trade workflow on the linked job", PM, 1, {
          dependsOn: ["^"],
          condition: any("construction_required"),
          requiredEvidence: "LINKED_JOB",
          requiredEvidenceParam: "WORKFLOW",
          description:
            "Open the linked job's Workflow tab and apply Roofing, Interior Renovation or Doors & Windows. Scope, materials, crews, scheduling, progress photos and permit inspections are tracked there, not here.",
        }),
        task("confirm_materials_scheduling_on_job", "Confirm materials and scheduling on the linked job", PM, 2, {
          dependsOn: ["^"],
          condition: any("construction_required"),
          checklist: ["Purchase orders issued on the job", "Start date set on the job", "Owner / occupant access confirmed", "Violation items linked to the job"],
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

    // ── Phase 6 — Agency Compliance ────────────────────────────────────
    {
      key: "agency_compliance",
      name: "Agency Compliance",
      band: B.AGENCY_COMPLIANCE,
      startsAfter: ["corrective_work_complete"],
      tasks: [
        task("mark_items_corrected", "Mark every violation item corrected and upload after photographs", CM, 1, {
          requiredEvidence: "PHOTO",
          checklist: ["Every item set to Corrected", "After photo on each item"],
        }),
        task("notify_code_officer", "Notify the code enforcement officer that corrections are complete", CM, 1, { dependsOn: ["^"], requiredEvidence: "NOTE" }),
        task("submit_proof_of_correction", "Submit proof of correction to the agency", CM, -5, {
          dependsOn: ["^"],
          anchor: "COMPLIANCE_DEADLINE",
          priority: "HIGH",
          requiredEvidence: "ATTACHMENT",
        }),
        task("request_reinspection", "Request agency reinspection", CM, -3, {
          dependsOn: ["^"],
          anchor: "COMPLIANCE_DEADLINE",
          priority: "HIGH",
          requiredEvidence: "NOTE",
          checklist: ["Request method and date", "Confirmation number"],
        }),
        task("schedule_assign_reinspection", "Schedule the reinspection and assign the attendee", CM, 1, {
          dependsOn: ["^"],
          checklist: ["Inspection date entered on the Inspections tab", "Attendee assigned", "Site access arranged"],
        }),
        task("agency_reinspection", "Attend agency reinspection and record the result", SUP, 3, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          description: "A FAIL blocks this step, reopens the re-cited items and creates correction tasks; it reopens when they close.",
        }),
        task("upload_inspection_report", "Upload the agency inspection report", CM, 1, { dependsOn: ["^"], requiredEvidence: "ATTACHMENT" }),
        task("obtain_written_compliance_confirmation", "Obtain written compliance confirmation from the agency", CM, 3, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "AGENCY_CONFIRMATION",
        }),
        task("confirm_fines_stopped", "Confirm with the agency that fines have stopped accruing", ACC, 2, {
          dependsOn: ["^"],
          condition: any("fines_accruing"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "STOPPED",
          description: "Record the official stop date on Fines & Liens. The system never stops the estimate on its own.",
        }),
        task("record_official_compliance_date", "Record the official compliance date", CM, 0, {
          dependsOn: ["obtain_written_compliance_confirmation"],
          checklist: ["Official compliance date entered on the case"],
        }),
      ],
    },

    // ── Phase 7 — Hearings, Fines and Liens ────────────────────────────
    {
      key: "hearings_fines_liens",
      name: "Hearings, Fines and Liens",
      band: B.HEARINGS_FINES_LIENS,
      startsAfter: ["obtain_management_owner_approval"],
      tasks: [
        // Hearing
        task("calendar_hearing", "Calendar the hearing and confirm reminders", CM, 1, {
          condition: any("hearing_required"),
          priority: "HIGH",
          checklist: ["Hearing date entered on the Hearings tab", "Location or virtual link", "Hearing notice attached"],
        }),
        task("assign_hearing_attendee", "Assign the hearing attendee", CM, -10, {
          dependsOn: ["^"],
          anchor: "HEARING_DATE",
          condition: any("hearing_required"),
          checklist: ["Attendee set on the hearing", "Attorney required?"],
        }),
        task("prepare_hearing_evidence", "Prepare the hearing evidence package", CM, -3, {
          dependsOn: ["^"],
          anchor: "HEARING_DATE",
          priority: "HIGH",
          condition: any("hearing_required"),
          requiredEvidence: "ATTACHMENT",
          checklist: ["Before / after photos", "Permits and inspection reports", "Proof of correction", "Timeline of actions", "Extension and appeal filings"],
        }),
        task("prepare_fine_mitigation_for_hearing", "Prepare the fine-mitigation argument for the hearing", ACC, -2, {
          dependsOn: ["prepare_hearing_evidence"],
          anchor: "HEARING_DATE",
          condition: all("hearing_required", "fines_accruing"),
          requiredEvidence: "ATTACHMENT",
        }),
        task("record_hearing_outcome", "Attend the hearing and record the outcome", CM, 1, {
          dependsOn: ["prepare_hearing_evidence"],
          anchor: "HEARING_DATE",
          condition: any("hearing_required"),
          requiredEvidence: "HEARING_RESULT",
        }),
        task("upload_hearing_order", "Upload the hearing order", CM, 1, { dependsOn: ["^"], condition: any("hearing_required"), requiredEvidence: "ATTACHMENT" }),
        task("calendar_order_deadlines", "Calendar the deadlines set by the order", CM, 1, {
          dependsOn: ["^"],
          condition: any("hearing_required"),
          priority: "HIGH",
          checklist: ["New compliance deadline entered (uses the deadline-change preview)", "Payment deadline entered", "Appeal deadline entered"],
        }),
        // Fines
        task("confirm_official_balance", "Confirm the official fine balance with the agency", ACC, 2, {
          condition: any("fines_accruing", "lien_recorded"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "OFFICIAL_BALANCE",
        }),
        task("submit_mitigation_request", "Submit a fine mitigation or reduction request", CM, 3, {
          dependsOn: ["^"],
          condition: any("fines_accruing", "lien_recorded"),
          requiredEvidence: "ATTACHMENT",
          description: "Skip with a reason if no mitigation is sought.",
        }),
        task("track_mitigation_decision", "Track the mitigation decision", CM, 10, {
          dependsOn: ["^"],
          condition: any("fines_accruing", "lien_recorded"),
          checklist: ["Decision recorded", "Mitigated amount entered"],
        }),
        task("obtain_payment_approval", "Obtain approval to pay fines and costs", PM, 2, {
          dependsOn: ["^"],
          blocking: true,
          condition: any("fines_accruing", "lien_recorded"),
          requiredEvidence: "ATTACHMENT",
        }),
        task("record_fine_payment", "Record the fine payment", ACC, 2, {
          dependsOn: ["^"],
          condition: any("fines_accruing", "lien_recorded"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "PAID",
          checklist: ["Amount paid entered", "Receipt attached"],
        }),
        // Lien
        task("record_lien_details", "Record lien amount and recording information", ACC, 1, {
          condition: any("lien_recorded"),
          requiredEvidence: "ATTACHMENT",
          checklist: ["Lien amount", "Recording date", "Instrument / book and page", "Recorded lien attached"],
        }),
        task("obtain_lien_release", "Obtain and record the lien release or satisfaction", ACC, 5, {
          dependsOn: ["record_fine_payment", "record_lien_details"],
          blocking: true,
          priority: "HIGH",
          condition: any("lien_recorded"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "LIEN_RELEASED",
          checklist: ["Release recorded", "Recording information entered"],
        }),
      ],
    },

    // ── Phase 8 — Closure ──────────────────────────────────────────────
    {
      key: "closure",
      name: "Closure",
      band: B.CLOSURE,
      startsAfter: ["record_official_compliance_date"],
      tasks: [
        task("confirm_all_items_complete", "Confirm every violation item is complete", CM, 1, {
          blocking: true,
          requiredEvidence: "VIOLATION_ITEMS",
          requiredEvidenceParam: "COMPLETE",
        }),
        task("confirm_required_tasks_complete", "Confirm all required case tasks are complete", CM, 0, {
          dependsOn: ["^"],
          checklist: ["No open blocking steps", "Correction tasks closed", "Linked job workflow complete or not required"],
        }),
        task("confirm_agency_compliance", "Confirm the agency compliance confirmation is on file", CM, 0, {
          dependsOn: ["^"],
          checklist: ["Written confirmation attached", "Official compliance date entered"],
        }),
        task("confirm_permits_closed", "Confirm permits are closed", PC, 2, {
          dependsOn: ["confirm_required_tasks_complete"],
          condition: REQ,
          requiredEvidence: "LINKED_JOB_PERMIT",
          requiredEvidenceParam: "FINAL",
        }),
        task("confirm_fines_liens_resolved", "Confirm fines and liens are resolved", ACC, 2, {
          dependsOn: ["confirm_required_tasks_complete"],
          condition: any("fines_accruing", "lien_recorded"),
          requiredEvidence: "FINE_STATUS",
          requiredEvidenceParam: "RESOLVED",
        }),
        task("reconcile_final_costs", "Reconcile final correction costs", ACC, 2, {
          dependsOn: ["confirm_required_tasks_complete"],
          checklist: ["Actual correction cost entered", "Administrative costs entered", "Fines paid entered", "Linked job costs reviewed"],
        }),
        task("upload_closeout_package", "Upload the closeout package", OA, 2, {
          dependsOn: ["confirm_agency_compliance", "confirm_permits_closed", "confirm_fines_liens_resolved", "reconcile_final_costs"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("obtain_manager_close_approval", "Obtain manager approval to close the case", PM, 1, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "NOTE",
        }),
        task("close_case", "Close case", CM, 0, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "AGENCY_CONFIRMATION",
          description:
            "Cannot be completed without the agency's compliance confirmation on file. An admin or manager may override with a written reason; the override is audited.",
        }),
      ],
    },
  ],
});
