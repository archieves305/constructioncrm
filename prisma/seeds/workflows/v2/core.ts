import { defineTemplate } from "../../../../src/lib/workflows/templates/define";
import { LEGAL_NO_PERMIT_WARNING, PHASE_BANDS as B } from "../../../../src/lib/workflows/templates/types";
import { ACC, NO_PERMIT_TASKS, OA, PC, PM, REQ, SUP, task } from "./_shorthand";

/**
 * Core Construction, streamlined — applied to every job.
 *
 * Milestones, not micro-steps: what used to be a run of small tasks is one
 * step with a short checklist. The permit branch and the closeout live here
 * ONCE per job, however many trades are on it. A trade plugs in through two
 * placeholder steps it overrides: `prepare_permit_documents` (so the single
 * "Submit the permit application" waits on every trade's documents) and
 * `complete_work` (so closeout waits on every trade finishing).
 *
 * Only real gates block: the deposit, the permit decision and its branch,
 * production start, inspections and the final payment. Evidence is required
 * only where the CRM reads the fact from its own records.
 */
export const CORE = defineTemplate({
  key: "core",
  name: "Core Construction",
  kind: "CORE",
  description: "The setup, permit, production and closeout milestones every job needs, whatever the trade.",
  phases: [
    {
      key: "job_setup",
      name: "Job Setup",
      band: B.JOB_SETUP,
      tasks: [
        task("review_contract", "Review contract, scope and job record", PM, 1, {
          checklist: [
            "Both signatures present",
            "Scope exhibits, exclusions and allowances noted",
            "Customer, address and folio match the contract",
            "Contract value and payment schedule match the job's invoices",
            "Insurance certificate requested if the contract requires one",
          ],
        }),
        task("assign_project_manager", "Assign project manager and superintendent", OA, 1, {
          blocking: true,
          checklist: ["Project manager set on the job", "Superintendent / field lead set on the Workflow team"],
        }),
        task("verify_deposit", "Verify deposit received", ACC, 3, {
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "PAYMENT_STATUS",
          requiredEvidenceParam: "DEPOSIT",
          description: "Completes once the deposit is recorded on the job. Ordering and production start wait on it.",
        }),
        task("determine_permit_requirement", "Determine permit requirement", PC, 3, {
          blocking: true,
          priority: "HIGH",
          description: "Set the permit status on the Workflow tab. Completing this step unlocks the permit or no-permit branch.",
          checklist: [
            "Jurisdiction confirmed (city vs unincorporated county; HVHZ)",
            "Scope checked against the exemption list",
            "Decision recorded on the Workflow tab",
          ],
        }),
        task("precon_plan", "Preconstruction plan", PM, 3, {
          dependsOn: ["review_contract"],
          checklist: [
            "Owner selections and open decisions confirmed",
            "Subcontractors, crew and material needs identified",
            "Target start date set on the job",
            "Site access, hours, HOA and occupant restrictions noted",
            "Customer sent a preconstruction update",
          ],
        }),
      ],
    },
    {
      key: "permit_required",
      name: "Permit",
      band: B.PERMITTING,
      permit: "REQUIRED",
      tasks: [
        // A placeholder: every trade's own documents step overrides it, so
        // it only survives on a Core-only job.
        task("prepare_permit_documents", "Assemble permit documents", PC, 3, {
          dependsOn: ["determine_permit_requirement"],
          checklist: ["Permit application completed", "Plans and product approvals the jurisdiction requires"],
        }),
        task("submit_permit_application", "Submit the permit application", PC, 2, {
          dependsOn: ["^"],
          priority: "HIGH",
          checklist: [
            "Owner authorization signed",
            "Notice of Commencement recorded, certified copy in hand — or not required for this contract",
            "Application and every trade's documents submitted",
            "Permit added on the Permits tab with the application date",
          ],
        }),
        task("confirm_permit_issued", "Confirm permit issued", PC, 10, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "PERMIT_NUMBER",
          description: "Completes once the permit number is on the Permits tab. Review and comment follow-ups are raised from the permit itself.",
          checklist: ["Permit and approved plans saved to the job", "Required inspections reviewed with the superintendent"],
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
      key: "production",
      name: "Production",
      band: B.CORE_PRODUCTION,
      tasks: [
        task("confirm_production_start", "Confirm production start", PM, -1, {
          anchor: "TARGET_START",
          dependsOn: ["verify_deposit", "confirm_permit_issued", "obtain_pm_approval_no_permit"],
          blocking: true,
          priority: "HIGH",
          checklist: [
            "Crew or subcontractor confirmed — subcontract and insurance certificate (GL + workers' comp) on file",
            "Materials on site or delivery confirmed",
            "Start date confirmed with the customer",
            "Site safety plan reviewed with the crew",
            "Permit card and NOC posted on site — or no permit on this job",
          ],
        }),
        // A placeholder: each trade's last installation step overrides it.
        task("complete_work", "Complete the work", SUP, 10, {
          dependsOn: ["^"],
          checklist: ["Contract scope complete", "Extra work covered by a signed change order", "Site clean, debris removed"],
        }),
      ],
    },
    {
      key: "closeout",
      name: "Closeout",
      band: B.CORE_CLOSEOUT,
      tasks: [
        task("complete_punch_list", "Punch list and customer walkthrough", PM, 5, {
          dependsOn: ["complete_work"],
          checklist: ["Internal quality walk done", "Punch list written with the customer", "Every punch item closed", "Customer accepted the work"],
        }),
        task("obtain_final_inspection", "Final inspection passed", PC, 5, {
          dependsOn: ["complete_work"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          condition: REQ,
          description:
            "Record Pass only when every permit and discipline on the job has passed its final. A Fail raises a correction task automatically and this step reopens when it is done.",
          checklist: ["Final inspection requested for every permit on the job"],
        }),
        task("collect_lien_releases", "Collect lien releases", ACC, 5, {
          dependsOn: ["complete_work"],
          blocking: true,
          checklist: [
            "Final release from every subcontractor",
            "Final release from every supplier that served a Notice to Owner",
            "Releases saved to the job",
          ],
        }),
        task("submit_final_invoice", "Send the final invoice", ACC, 1, {
          dependsOn: ["complete_punch_list", "obtain_final_inspection"],
          priority: "HIGH",
          checklist: ["Approved change orders included", "Final invoice sent from the Invoices tab"],
        }),
        task("confirm_final_payment", "Confirm final payment", ACC, 5, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "PAYMENT_STATUS",
          requiredEvidenceParam: "FINAL",
        }),
        task("close_job", "Close the job", PM, 2, {
          dependsOn: ["confirm_final_payment", "collect_lien_releases"],
          checklist: [
            "Warranties registered and delivered to the customer",
            "Permit closed on the Permits tab — or no permit",
            "Closeout documents saved to the job",
            "Job moved to the Closed stage",
          ],
        }),
      ],
    },
  ],
});
