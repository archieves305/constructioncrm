import { defineTemplate } from "../../../../src/lib/workflows/templates/define";
import { PHASE_BANDS as B } from "../../../../src/lib/workflows/templates/types";
import { PC, PM, REQ, SUP, any, task, when } from "./_shorthand";

/**
 * Roofing, streamlined: ten milestones. The permit run and the closeout are
 * Core's; roofing contributes its permit documents, its two in-progress
 * inspections and the install itself.
 */
export const ROOFING = defineTemplate({
  key: "roofing",
  name: "Roofing",
  kind: "TRADE",
  trade: "Roofing",
  serviceCategoryNames: ["Roofing"],
  description: "Re-roof and roof-replacement work: scope, ordering, readiness and installation. Permit and closeout run once in Core.",
  scopeToggles: [
    { key: "tear_off", label: "Tear-off", default: true },
    { key: "deck_repairs", label: "Deck repairs", default: true },
    { key: "low_slope", label: "Low-slope system", description: "TPO, PVC, modified bitumen or coating.", default: false },
    { key: "crane", label: "Crane required", default: false },
    { key: "mfr_warranty", label: "Manufacturer warranty", default: true },
    { key: "occupied", label: "Occupied building", default: true },
  ],
  phases: [
    {
      key: "scope_review",
      name: "Roofing Scope",
      band: B.SCOPE_REVIEW,
      tasks: [
        task("confirm_roof_scope", "Confirm roof system and scope", PM, 3, {
          blocking: true,
          checklist: [
            "Measurements verified (squares, pitch, eave / rake LF, penetrations)",
            "System matches the contract — underlayment, fastening, flashing details, NOA / Florida Product Approval",
            when(["tear_off", "deck_repairs"], "Tear-off layers, deck type and deck-repair unit price / allowance confirmed"),
            when("low_slope", "Insulation, taper and drainage confirmed"),
            when("mfr_warranty", "Manufacturer warranty requirements confirmed"),
            "Existing roof conditions photographed",
          ],
        }),
        task("roofing_permit_documents", "Assemble roofing permit documents", PC, 3, {
          dependsOn: ["confirm_roof_scope", "core:determine_permit_requirement"],
          condition: REQ,
          overridesCoreKey: "prepare_permit_documents",
          checklist: [
            "Roofing permit application completed",
            "NOAs / Florida Product Approvals for the assembly",
            "Roof plan, fastening calculations and assembly details",
          ],
        }),
      ],
    },
    {
      key: "procurement",
      name: "Roofing Order and Readiness",
      band: B.PROCUREMENT,
      tasks: [
        task("order_roofing_materials", "Order roofing materials", PM, 3, {
          dependsOn: ["confirm_roof_scope", "core:verify_deposit"],
          priority: "HIGH",
          checklist: [
            "Supplier quote matches the confirmed system and quantities",
            "Color and owner selections confirmed in writing",
            "Purchase order issued",
            "Delivery date confirmed",
            "Supplier Notice to Owner logged for closeout",
          ],
        }),
        task("roofing_ready_to_start", "Roofing ready to start", SUP, -3, {
          anchor: "TARGET_START",
          dependsOn: ["order_roofing_materials"],
          checklist: [
            "Crew or subcontractor assigned, pre-start meeting held",
            "Weather window confirmed",
            "Delivery, staging and storage confirmed",
            when("tear_off", "Dumpster scheduled"),
            when("crane", "Crane / rooftop loading scheduled"),
            when("occupied", "Occupants notified"),
          ],
        }),
        task("fall_protection_plan", "Fall-protection and site safety plan", SUP, -1, {
          anchor: "TARGET_START",
          dependsOn: ["order_roofing_materials"],
          blocking: true,
          priority: "URGENT",
          checklist: ["Anchors", "Personal fall-arrest systems", "Warning lines", "Ladder tie-off", "Safety plan reviewed with the crew"],
        }),
      ],
    },
    {
      key: "installation",
      name: "Roofing Installation",
      band: B.INSTALLATION,
      tasks: [
        task("mobilize_and_prepare", "Mobilize, tear off and prepare the deck", SUP, 2, {
          dependsOn: ["core:confirm_production_start", "fall_protection_plan", "roofing_ready_to_start"],
          priority: "HIGH",
          checklist: [
            "Building, landscaping and AC units protected",
            when("occupied", "Occupant access paths kept clear"),
            when("tear_off", "Tear-off complete"),
            when(["tear_off", "deck_repairs"], "Deck inspected, repairs logged (sheets / LF)"),
            when("deck_repairs", "Change order signed if repairs exceed the allowance"),
          ],
        }),
        task("deck_inspection", "Deck / sheathing inspection", SUP, 1, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          condition: { ...REQ, ...any("tear_off", "deck_repairs") },
        }),
        task("dry_in_inspection", "Dry-in / in-progress inspection", SUP, 2, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          condition: REQ,
          checklist: ["Dry-in complete"],
        }),
        task("install_roof_system", "Install roof system", SUP, 5, {
          dependsOn: ["^"],
          overridesCoreKey: "complete_work",
          checklist: [
            "Dry-in and roofing assembly installed per the product approval",
            "Flashing, penetrations and edge metal complete",
            "Drainage verified",
            "Internal quality check done, corrections complete",
            "Equipment, debris and protection removed",
          ],
        }),
        task("manufacturer_warranty", "Obtain manufacturer warranty", PM, 10, {
          dependsOn: ["^"],
          condition: any("mfr_warranty"),
          checklist: ["Manufacturer inspection passed, if required", "Warranty registration submitted", "Warranty certificate saved to the job"],
        }),
      ],
    },
  ],
});
