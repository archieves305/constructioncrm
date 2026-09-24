import { defineTemplate } from "../../../src/lib/workflows/templates/define";
import { PHASE_BANDS as B } from "../../../src/lib/workflows/templates/types";
import { ACC, OA, PC, PM, PUR, QC, SUP, task, REQ } from "./_shorthand";

/**
 * Core Construction — applied to every job. Trade templates override the
 * closeout tasks they have a more specific version of (see overridesCoreKey).
 */
export const CORE = defineTemplate({
  key: "core",
  name: "Core Construction",
  kind: "CORE",
  description: "The job-setup, preconstruction, production and closeout steps every job needs, whatever the trade.",
  phases: [
    {
      key: "job_setup",
      name: "Job Setup",
      band: B.JOB_SETUP,
      tasks: [
        task("review_contract", "Review executed contract and scope", PM, 1, {
          anchor: "JOB_CREATED",
          requiredEvidence: "ATTACHMENT",
          checklist: ["Both signatures present", "Scope exhibits attached", "Exclusions noted", "Allowances listed"],
        }),
        task("confirm_customer_property", "Confirm customer and property information", OA, 1, {
          anchor: "JOB_CREATED",
          checklist: ["Legal owner name", "Address matches contract", "Folio / parcel number", "Primary contact"],
        }),
        task("confirm_contract_value_payment_schedule", "Confirm contract value and payment schedule", ACC, 2, {
          dependsOn: ["review_contract"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("verify_deposit", "Verify deposit or initial payment", ACC, 2, {
          dependsOn: ["confirm_contract_value_payment_schedule"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "PAYMENT_STATUS",
          requiredEvidenceParam: "DEPOSIT",
        }),
        task("assign_project_manager", "Assign project manager", OA, 1, { anchor: "JOB_CREATED", blocking: true }),
        task("determine_permit_requirement", "Determine permit requirement", PC, 3, {
          dependsOn: ["review_contract"],
          blocking: true,
          priority: "HIGH",
          description: "Set the permit status on the Workflow tab. Completing this step unlocks the permit or no-permit branch.",
          checklist: ["Jurisdiction consulted", "Scope checked against exemption list", "Decision recorded on the Workflow tab"],
        }),
        task("confirm_jurisdiction", "Confirm jurisdiction", PC, 3, {
          anchor: "JOB_CREATED",
          checklist: ["City vs unincorporated county", "HVHZ yes / no"],
        }),
        task("create_job_budget", "Create job budget and cost codes, if supported", ACC, 4, {
          dependsOn: ["confirm_contract_value_payment_schedule"],
        }),
        task("confirm_insurance_certificates", "Confirm insurance and certificate requirements", OA, 4, {
          dependsOn: ["review_contract"],
          requiredEvidence: "ATTACHMENT",
          checklist: ["General liability", "Workers' comp", "Additional insured", "Subcontractor COIs"],
        }),
        task("schedule_internal_kickoff", "Schedule internal kickoff", PM, 5, { dependsOn: ["assign_project_manager"] }),
      ],
    },
    {
      key: "preconstruction",
      name: "Preconstruction",
      band: B.PRECONSTRUCTION,
      startsAfter: ["schedule_internal_kickoff"],
      tasks: [
        task("complete_precon_review", "Complete preconstruction review", PM, 1),
        task("confirm_selections_owner_decisions", "Confirm selections and outstanding owner decisions", PM, 2, {
          dependsOn: ["^"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("confirm_subcontractor_requirements", "Confirm subcontractor requirements", PM, 1, { dependsOn: ["complete_precon_review"] }),
        task("confirm_material_procurement_requirements", "Confirm material procurement requirements", PUR, 1, {
          dependsOn: ["complete_precon_review"],
        }),
        task("establish_preliminary_schedule", "Establish preliminary schedule", PM, 2, {
          dependsOn: ["confirm_selections_owner_decisions", "confirm_subcontractor_requirements", "confirm_material_procurement_requirements"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("send_customer_precon_update", "Send customer preconstruction update", PM, 1, { dependsOn: ["^"] }),
        task("confirm_site_access_restrictions", "Confirm site access and operating restrictions", SUP, 1, {
          dependsOn: ["complete_precon_review"],
          checklist: ["Working hours", "Parking", "HOA rules", "Occupants"],
        }),
        task("confirm_safety_requirements", "Confirm safety requirements", SUP, 1, { dependsOn: ["^"], priority: "URGENT" }),
      ],
    },
    {
      key: "production",
      name: "Production",
      band: B.CORE_PRODUCTION,
      startsAfter: ["establish_preliminary_schedule", "verify_deposit"],
      tasks: [
        task("confirm_production_start", "Confirm production start", PM, 0, {
          dependsOn: ["verify_deposit", "establish_preliminary_schedule"],
          blocking: true,
          priority: "HIGH",
        }),
        task("maintain_daily_documentation", "Maintain daily job documentation", SUP, 1, {
          dependsOn: ["^"],
          description: "Stays open through production; close it at closeout.",
        }),
        task("upload_progress_photos", "Upload required progress photographs", SUP, 1, {
          dependsOn: ["confirm_production_start"],
          requiredEvidence: "PHOTO",
        }),
        task("document_field_conditions", "Document field conditions", SUP, 1, {
          dependsOn: ["confirm_production_start"],
          requiredEvidence: "PHOTO",
        }),
        task("approve_change_orders_before_work", "Create and approve change orders before additional work", PM, 1, {
          dependsOn: ["confirm_production_start"],
        }),
        task("monitor_schedule_dependencies", "Monitor schedule and outstanding dependencies", PM, 3, {
          dependsOn: ["confirm_production_start"],
        }),
      ],
    },
    {
      key: "closeout",
      name: "Closeout",
      band: B.CORE_CLOSEOUT,
      startsAfter: ["monitor_schedule_dependencies"],
      tasks: [
        task("internal_quality_inspection", "Perform internal quality inspection", QC, 1, { requiredEvidence: "PHOTO" }),
        task("create_punch_list", "Create punch list", PM, 1, { dependsOn: ["^"], requiredEvidence: "ATTACHMENT" }),
        task("complete_punch_list", "Complete punch list", SUP, 3, { dependsOn: ["^"], requiredEvidence: "PHOTO" }),
        task("obtain_final_inspection", "Obtain required final inspection", PC, 3, {
          dependsOn: ["complete_punch_list"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          condition: REQ,
        }),
        task("collect_lien_releases", "Collect subcontractor and supplier lien releases", ACC, 3, {
          dependsOn: ["complete_punch_list"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("assemble_closeout_documents", "Assemble closeout documents", OA, 2, {
          dependsOn: ["obtain_final_inspection", "collect_lien_releases"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("submit_final_invoice", "Submit final invoice", ACC, 1, {
          dependsOn: ["obtain_final_inspection", "complete_punch_list"],
          priority: "HIGH",
          requiredEvidence: "ATTACHMENT",
        }),
        task("confirm_final_payment", "Confirm final payment", ACC, 5, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "PAYMENT_STATUS",
          requiredEvidenceParam: "FINAL",
        }),
        task("deliver_warranty_documents", "Deliver warranty documents", OA, 2, {
          dependsOn: ["confirm_final_payment", "assemble_closeout_documents"],
          requiredEvidence: "ATTACHMENT",
        }),
        task("close_job", "Close Job", PM, 1, {
          dependsOn: ["deliver_warranty_documents", "confirm_final_payment", "collect_lien_releases"],
        }),
      ],
    },
  ],
});
