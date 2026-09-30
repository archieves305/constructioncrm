import { defineTemplate } from "../../../../src/lib/workflows/templates/define";
import { PHASE_BANDS as B } from "../../../../src/lib/workflows/templates/types";
import { PC, PM, REQ, SR, SUP, task, when } from "./_shorthand";

/** Exterior openings of any kind. */
const EXT = ["windows", "exterior_doors", "storefront"];

/**
 * Doors & Windows, streamlined: eight milestones. The owner's sign-off on
 * the final order stays its own gate — the units are custom and the order
 * is the expensive, irreversible step.
 */
export const DOORS_WINDOWS = defineTemplate({
  key: "doors_windows",
  name: "Doors & Windows",
  kind: "TRADE",
  trade: "Doors & Windows",
  serviceCategoryNames: ["Windows", "Doors"],
  description: "Window and door replacement: specs, owner sign-off, ordering, delivery and installation. Permit and closeout run once in Core.",
  scopeToggles: [
    { key: "windows", label: "Windows", default: true },
    { key: "exterior_doors", label: "Exterior doors", default: true },
    { key: "storefront", label: "Storefront", default: false },
    { key: "impact", label: "Impact products", default: true },
    { key: "engineering", label: "Engineering required", default: false },
    { key: "restoration", label: "Interior / exterior restoration", default: true },
  ],
  phases: [
    {
      key: "scope_review",
      name: "Doors & Windows Scope",
      band: B.SCOPE_REVIEW,
      tasks: [
        task("confirm_openings_and_specs", "Confirm openings, measurements and product specs", PM, 3, {
          blocking: true,
          checklist: [
            "Opening count and field measurements verified",
            "Types, colors, frame, glass and hardware selected",
            when(EXT, "Impact requirement and design pressure per opening confirmed"),
            when(EXT, "Egress and energy requirements checked"),
            when("restoration", "Restoration scope confirmed"),
            when("engineering", "Site-specific engineering ordered"),
            "Existing openings photographed",
          ],
        }),
        task("owner_signoff_order_specs", "Owner sign-off on the final order", SR, 2, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          checklist: [
            "Final field measurements re-verified",
            "Owner signed the product selection / order sheet",
            "Product approval numbers match the order",
          ],
        }),
        task("dw_permit_documents", "Assemble door and window permit documents", PC, 3, {
          dependsOn: ["confirm_openings_and_specs", "core:determine_permit_requirement"],
          condition: REQ,
          overridesCoreKey: "prepare_permit_documents",
          checklist: [
            "Permit application completed",
            "Opening schedule with sizes and design pressures",
            when(EXT, "NOAs / Florida Product Approvals per product"),
            when("engineering", "Signed and sealed calculations"),
          ],
        }),
      ],
    },
    {
      key: "procurement",
      name: "Doors & Windows Order and Delivery",
      band: B.PROCUREMENT,
      tasks: [
        task("order_windows_doors", "Order windows and doors", PM, 3, {
          dependsOn: ["owner_signoff_order_specs", "core:verify_deposit"],
          priority: "HIGH",
          description: "Stays open while the units are in production; complete it when the manufacturer confirms the delivery date.",
          checklist: [
            "Order placed, purchase order saved to the job",
            "Manufacturer acknowledgment matches the signed order",
            "Installation materials ordered (anchors per NOA, sealant, shims, flashing tape)",
            "Delivery date confirmed by the manufacturer",
          ],
        }),
        task("receive_delivery_and_prepare", "Receive delivery and get ready to install", SUP, 5, {
          dependsOn: ["^"],
          priority: "HIGH",
          checklist: [
            "Delivery matches the order, no damage",
            when("impact", "Labels and serial numbers documented"),
            "Crew and install date set",
            "Site access, occupied-area protection and disposal planned",
            when("storefront", "Lift / scaffold arranged"),
            "Approved plans and product approvals on site",
          ],
        }),
      ],
    },
    {
      key: "installation",
      name: "Doors & Windows Installation",
      band: B.INSTALLATION,
      tasks: [
        task("install_units", "Remove, prepare and install", SUP, 3, {
          dependsOn: ["core:confirm_production_start", "receive_delivery_and_prepare"],
          priority: "HIGH",
          checklist: [
            "Pre-install photos taken, finishes protected",
            "Existing units removed, rough openings inspected",
            "Concealed damage documented — change order signed before extra repairs",
            "Units installed with approved anchors (type, embedment, spacing per NOA)",
            when(EXT, "Flashing, waterproofing and sealants complete"),
          ],
        }),
        task("in_progress_inspection", "In-progress (buck / anchor) inspection", SUP, 1, {
          dependsOn: ["^"],
          blocking: true,
          priority: "HIGH",
          requiredEvidence: "INSPECTION_RESULT",
          condition: REQ,
        }),
        task("finish_and_test", "Restoration, hardware and final checks", SUP, 3, {
          dependsOn: ["^"],
          overridesCoreKey: "complete_work",
          checklist: [
            when("restoration", "Restoration complete"),
            "Hardware and screens installed",
            "Every unit tested for operation and locking",
            "Product labels left in place for the final inspection",
            "Final cleaning done, debris removed",
          ],
        }),
      ],
    },
  ],
});
