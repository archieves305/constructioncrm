import { defineTemplate } from "../../../../src/lib/workflows/templates/define";
import { PHASE_BANDS as B } from "../../../../src/lib/workflows/templates/types";
import { PC, PM, REQ, SUP, any, task, when } from "./_shorthand";

/** The disciplines that bring rough-ins and their inspections. */
const ROUGH = ["framing", "plumbing", "electrical", "hvac", "fire_protection"];

/**
 * Interior Renovation, streamlined: ten milestones. The eleven scope
 * options stay — they still switch whole steps (rough-ins, inspections) and
 * the checklist lines inside the rest. With every option off the chain
 * still connects: finishes wait on mobilization.
 */
export const INTERIOR_RENOVATION = defineTemplate({
  key: "interior_renovation",
  name: "Interior Renovation",
  kind: "TRADE",
  trade: "Interior Renovation",
  serviceCategoryNames: ["Interior Renovations", "Drywall"],
  description: "Kitchens, baths, drywall and general interior work, with each trade discipline as an optional scope. Permit and closeout run once in Core.",
  scopeToggles: [
    { key: "demolition", label: "Demolition", default: true },
    { key: "framing", label: "Framing", default: false },
    { key: "drywall", label: "Drywall", default: true },
    { key: "painting", label: "Painting", default: true },
    { key: "flooring", label: "Flooring", default: true },
    { key: "cabinets", label: "Cabinets and countertops", default: false },
    { key: "plumbing", label: "Plumbing", default: false },
    { key: "electrical", label: "Electrical", default: false },
    { key: "hvac", label: "HVAC", default: false },
    { key: "fire_protection", label: "Fire protection", default: false },
    { key: "doors_trim", label: "Doors and trim", default: true },
  ],
  phases: [
    {
      key: "scope_review",
      name: "Interior Scope",
      band: B.SCOPE_REVIEW,
      tasks: [
        task("confirm_plans_and_selections", "Confirm plans, scope and finish selections", PM, 3, {
          blocking: true,
          checklist: [
            "Plans and room-by-room scope verified",
            "Finish schedule and selections signed by the owner",
            when("demolition", "Demolition limits marked"),
            when("framing", "Structural work confirmed — load-bearing walls identified, engineer letter obtained"),
            when(["plumbing", "electrical", "hvac", "fire_protection"], "Trade scope confirmed with licensed subcontractors"),
            "Accessibility and occupied-building restrictions noted",
            "Existing conditions photographed",
          ],
        }),
        task("interior_permit_documents", "Assemble interior permit documents", PC, 4, {
          dependsOn: ["confirm_plans_and_selections", "core:determine_permit_requirement"],
          condition: REQ,
          overridesCoreKey: "prepare_permit_documents",
          checklist: [
            "Building permit application completed",
            "Architectural / engineering plans",
            "Product approvals where required",
            when("electrical", "Electrical permit"),
            when("plumbing", "Plumbing permit"),
            when("hvac", "Mechanical permit"),
            when("fire_protection", "Fire permit"),
          ],
        }),
      ],
    },
    {
      key: "procurement",
      name: "Interior Order and Readiness",
      band: B.PROCUREMENT,
      tasks: [
        task("order_materials_and_subcontracts", "Issue purchase orders and subcontracts", PM, 5, {
          dependsOn: ["confirm_plans_and_selections", "core:verify_deposit"],
          priority: "HIGH",
          checklist: [
            "Subcontracts signed, license and insurance on file",
            "Long-lead items ordered",
            when("cabinets", "Cabinets and countertops ordered"),
            when(["plumbing", "electrical"], "Fixtures ordered"),
            when(["flooring", "doors_trim"], "Flooring, doors and hardware ordered"),
            "Delivery schedule and storage location set",
          ],
        }),
        task("safety_and_site_readiness", "Safety plan and site readiness", SUP, -2, {
          anchor: "TARGET_START",
          dependsOn: ["^"],
          blocking: true,
          priority: "URGENT",
          checklist: [
            "Safety plan reviewed with crew and subs",
            "Dust control and occupied-space protection set",
            "Access, working hours and building rules confirmed",
            "Temporary utilities, dumpster and debris removal arranged",
            "Baseline schedule shared with the subs",
          ],
        }),
      ],
    },
    {
      key: "construction",
      name: "Interior Construction",
      band: B.INSTALLATION,
      tasks: [
        task("mobilize_and_demolish", "Mobilize, protect and demolish", SUP, 3, {
          dependsOn: ["core:confirm_production_start", "safety_and_site_readiness"],
          priority: "HIGH",
          checklist: [
            "Floor, dust and occupied-area protection installed",
            when("demolition", "Demolition complete"),
            when("demolition", "Concealed conditions documented — change order signed before extra work"),
          ],
        }),
        task("framing_and_rough_ins", "Framing and rough-ins", SUP, 5, {
          dependsOn: ["^"],
          condition: any(...ROUGH),
          checklist: [
            when("framing", "Structural framing"),
            when("plumbing", "Plumbing rough-in"),
            when("electrical", "Electrical rough-in"),
            when("hvac", "HVAC rough-in"),
            when("fire_protection", "Fire-protection rough-in"),
          ],
        }),
        task("rough_inspections", "Rough inspections", SUP, 2, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          condition: { ...REQ, ...any(...ROUGH) },
        }),
        task("insulation_inspection", "Insulation inspection", SUP, 1, {
          dependsOn: ["^"],
          blocking: true,
          requiredEvidence: "INSPECTION_RESULT",
          condition: { ...REQ, ...any("framing") },
          checklist: ["Insulation installed"],
        }),
        task("drywall_and_paint", "Insulation, drywall and paint", SUP, 8, {
          dependsOn: ["^"],
          condition: any("framing", "drywall", "painting"),
          checklist: [when("framing", "Insulation installed"), when("drywall", "Drywall hung and finished"), when("painting", "Primed and painted")],
        }),
        task("install_finishes", "Install finishes and trim out", SUP, 8, {
          dependsOn: ["^"],
          overridesCoreKey: "complete_work",
          checklist: [
            when("cabinets", "Cabinets and countertops"),
            when("flooring", "Flooring"),
            when("doors_trim", "Doors, trim and hardware"),
            when(["plumbing", "electrical", "hvac"], "Trim-out complete"),
            "Final finishes complete",
            "Internal quality review done",
          ],
        }),
      ],
    },
  ],
});
