/**
 * How the first generation of templates maps onto the streamlined one.
 *
 * Keys are FULL keys ("<template>:<step>"), because a streamlined Core step
 * absorbs steps from Core v1 AND from each trade's v1 (the permit run and
 * the closeout moved into Core). The one-time migration reads this: a
 * streamlined step is done when every v1 step listed for it that existed on
 * the job was completed (or skipped by a person).
 *
 * `seed-mapping.test.ts` holds this file to the specs: every v1 step appears
 * exactly once — absorbed or dropped — and every target exists.
 */

const T = ["roofing", "interior_renovation", "doors_windows"] as const;
const each = (...keys: string[]) => T.flatMap((t) => keys.map((k) => `${t}:${k}`));

/** Streamlined step → the v1 steps it absorbs. */
export const SLIM_ABSORBS: Record<string, string[]> = {
  // ── Core ───────────────────────────────────────────────────────────────
  "core:review_contract": ["core:review_contract", "core:confirm_customer_property", "core:confirm_contract_value_payment_schedule"],
  "core:assign_project_manager": ["core:assign_project_manager", "roofing:assign_superintendent", "interior_renovation:assign_pm_and_superintendent"],
  "core:verify_deposit": ["core:verify_deposit"],
  "core:determine_permit_requirement": ["core:determine_permit_requirement", "core:confirm_jurisdiction"],
  "core:precon_plan": [
    "core:schedule_internal_kickoff",
    "core:complete_precon_review",
    "core:confirm_selections_owner_decisions",
    "core:confirm_subcontractor_requirements",
    "core:confirm_material_procurement_requirements",
    "core:establish_preliminary_schedule",
    "core:send_customer_precon_update",
    "core:confirm_site_access_restrictions",
  ],
  "core:submit_permit_application": [
    "roofing:confirm_owner_authorization",
    "roofing:prepare_notice_of_commencement",
    "roofing:submit_permit_package",
    "interior_renovation:obtain_owner_authorization",
    "interior_renovation:prepare_notice_of_commencement",
    "interior_renovation:submit_permit_application",
    "doors_windows:confirm_owner_authorization",
    "doors_windows:prepare_notice_of_commencement",
    "doors_windows:submit_permit_package",
  ],
  "core:confirm_permit_issued": [
    ...each("confirm_permit_issued", "confirm_inspection_sequence"),
    "roofing:upload_permit_documents",
    "roofing:confirm_inspections_scheduled",
    "interior_renovation:upload_approved_plans",
    "interior_renovation:create_inspection_schedule_by_discipline",
    "doors_windows:upload_approved_permit_documents",
    "doors_windows:confirm_inspection_requirements",
  ],
  "core:verify_no_permit_required": each("verify_no_permit_required", "record_no_permit_confirmation", "upload_no_permit_support"),
  "core:obtain_pm_approval_no_permit": each("obtain_pm_approval_no_permit"),
  "core:confirm_production_start": [
    "core:confirm_production_start",
    "core:confirm_safety_requirements",
    "core:confirm_insurance_certificates",
    "roofing:post_permit_at_site",
    "roofing:notify_customer_start_date",
    "interior_renovation:post_permit_approved_plans",
    "interior_renovation:notify_customer_start_date",
    "doors_windows:post_permit_approved_documents",
    "doors_windows:notify_customer_installation_date",
  ],
  "core:complete_punch_list": [
    "core:internal_quality_inspection",
    "core:create_punch_list",
    "core:complete_punch_list",
    "roofing:complete_roofing_punch_list",
    "roofing:obtain_final_approval",
    "interior_renovation:complete_internal_punch_list",
    "interior_renovation:complete_owner_punch_list",
    "interior_renovation:perform_final_cleaning",
    "doors_windows:complete_installation_punch_list",
    "doors_windows:obtain_final_approval",
  ],
  "core:obtain_final_inspection": [
    "core:obtain_final_inspection",
    "roofing:request_final_inspection",
    "roofing:record_final_inspection_result",
    "interior_renovation:complete_trade_inspections",
    "interior_renovation:request_final_building_inspection",
    "interior_renovation:record_inspection_results",
    "doors_windows:request_final_inspection",
    "doors_windows:record_final_inspection_result",
  ],
  "core:collect_lien_releases": ["core:collect_lien_releases", ...each("collect_sub_supplier_releases")],
  "core:submit_final_invoice": ["core:submit_final_invoice", ...each("submit_final_invoice")],
  "core:confirm_final_payment": ["core:confirm_final_payment", ...each("confirm_final_payment")],
  "core:close_job": [
    "core:assemble_closeout_documents",
    "core:deliver_warranty_documents",
    "core:close_job",
    "roofing:upload_warranty_maintenance_docs",
    "roofing:close_roofing_workflow",
    "interior_renovation:collect_warranties_manuals",
    "interior_renovation:close_interior_workflow",
    "doors_windows:register_manufacturer_warranties",
    "doors_windows:deliver_warranty_operation_info",
    "doors_windows:close_doors_windows_workflow",
  ],

  // ── Roofing ────────────────────────────────────────────────────────────
  "roofing:confirm_roof_scope": [
    "roofing:verify_roof_measurements",
    "roofing:confirm_roof_system",
    "roofing:confirm_tear_off_scope",
    "roofing:confirm_decking_assumptions",
    "roofing:confirm_insulation_spec",
    "roofing:confirm_flashing_penetrations",
    "roofing:confirm_drainage_tapered",
    "roofing:confirm_mfr_warranty_requirements",
    "roofing:document_existing_roof_conditions",
  ],
  "roofing:roofing_permit_documents": ["roofing:prepare_permit_application", "roofing:gather_product_approvals", "roofing:gather_plans_fastening_docs"],
  "roofing:order_roofing_materials": [
    "roofing:obtain_final_supplier_quote",
    "roofing:confirm_manufacturer_product",
    "roofing:confirm_color_owner_selections",
    "roofing:issue_purchase_order",
    "roofing:confirm_availability_lead_time",
    "roofing:confirm_insulation_accessory_quantities",
    "roofing:schedule_material_delivery",
    "roofing:confirm_supplier_nto",
  ],
  "roofing:roofing_ready_to_start": [
    "roofing:confirm_staging_dumpster_crane",
    "roofing:confirm_storage_staging_plan",
    "roofing:assign_crew_subcontractor",
    "roofing:conduct_roofing_precon_meeting",
    "roofing:confirm_weather_window",
    "roofing:confirm_dumpster_delivery",
    "roofing:confirm_crane_schedule",
  ],
  "roofing:fall_protection_plan": ["roofing:confirm_site_safety_plan", "roofing:confirm_fall_protection_plan"],
  "roofing:mobilize_and_prepare": [
    "roofing:mobilize",
    "roofing:photograph_existing_conditions",
    "roofing:protect_building_property",
    "roofing:complete_tear_off",
    "roofing:inspect_roof_deck",
    "roofing:document_deck_repairs",
  ],
  "roofing:deck_inspection": ["roofing:obtain_deck_inspection"],
  "roofing:dry_in_inspection": ["roofing:obtain_dry_in_inspection"],
  "roofing:install_roof_system": [
    "roofing:complete_dry_in",
    "roofing:install_insulation_roofing_assembly",
    "roofing:complete_flashing_edge_metal",
    "roofing:verify_drainage",
    "roofing:perform_internal_roofing_qc",
    "roofing:complete_corrective_work",
    "roofing:remove_equipment_debris",
  ],
  "roofing:manufacturer_warranty": ["roofing:complete_mfr_inspection", "roofing:obtain_manufacturer_warranty"],

  // ── Doors & Windows ────────────────────────────────────────────────────
  "doors_windows:confirm_openings_and_specs": [
    "doors_windows:verify_opening_count",
    "doors_windows:verify_field_measurements",
    "doors_windows:confirm_window_door_types",
    "doors_windows:confirm_impact_requirements",
    "doors_windows:confirm_design_pressures",
    "doors_windows:confirm_egress_requirements",
    "doors_windows:confirm_energy_requirements",
    "doors_windows:confirm_product_colors_finishes",
    "doors_windows:confirm_frame_glass_hardware",
    "doors_windows:confirm_restoration_scope",
    "doors_windows:photograph_existing_openings",
  ],
  "doors_windows:owner_signoff_order_specs": [
    "doors_windows:obtain_owner_approval_order_specs",
    "doors_windows:confirm_final_field_measurements",
    "doors_windows:obtain_signed_product_selection",
    "doors_windows:confirm_product_approval_numbers",
  ],
  "doors_windows:dw_permit_documents": [
    "doors_windows:prepare_permit_application",
    "doors_windows:gather_product_approvals",
    "doors_windows:prepare_opening_schedule",
    "doors_windows:confirm_dp_documentation",
  ],
  "doors_windows:order_windows_doors": [
    "doors_windows:place_material_order",
    "doors_windows:upload_purchase_order",
    "doors_windows:confirm_manufacturer_acknowledgment",
    "doors_windows:confirm_production_lead_time",
    "doors_windows:track_manufacturing_status",
    "doors_windows:confirm_delivery_date",
    "doors_windows:confirm_installation_materials_fasteners",
  ],
  "doors_windows:receive_delivery_and_prepare": [
    "doors_windows:inspect_delivered_products",
    "doors_windows:document_serial_numbers_labels",
    "doors_windows:schedule_installation",
    "doors_windows:assign_installation_crew",
    "doors_windows:confirm_site_access",
    "doors_windows:confirm_protection_occupied_areas",
    "doors_windows:confirm_equipment_staging",
    "doors_windows:confirm_weather_conditions",
    "doors_windows:confirm_disposal_plan",
    "doors_windows:confirm_docs_onsite",
  ],
  "doors_windows:install_units": [
    "doors_windows:photograph_pre_installation",
    "doors_windows:protect_adjacent_finishes",
    "doors_windows:remove_existing_products",
    "doors_windows:inspect_rough_openings",
    "doors_windows:document_concealed_damage",
    "doors_windows:create_co_additional_repairs",
    "doors_windows:prepare_openings",
    "doors_windows:install_windows_doors",
    "doors_windows:install_anchors_fasteners",
    "doors_windows:complete_flashing_waterproofing",
    "doors_windows:complete_sealants",
  ],
  "doors_windows:in_progress_inspection": ["doors_windows:obtain_in_progress_inspection"],
  "doors_windows:finish_and_test": [
    "doors_windows:complete_restoration",
    "doors_windows:install_hardware_screens",
    "doors_windows:test_operation_locking",
    "doors_windows:verify_labels_available",
    "doors_windows:perform_internal_quality_inspection",
    "doors_windows:complete_final_cleaning",
  ],

  // ── Interior Renovation ────────────────────────────────────────────────
  "interior_renovation:confirm_plans_and_selections": [
    "interior_renovation:verify_plans_scope",
    "interior_renovation:confirm_demolition_limits",
    "interior_renovation:confirm_room_by_room_scope",
    "interior_renovation:confirm_finish_selections",
    "interior_renovation:confirm_structural_work",
    "interior_renovation:confirm_electrical_work",
    "interior_renovation:confirm_plumbing_work",
    "interior_renovation:confirm_hvac_work",
    "interior_renovation:confirm_fire_protection_requirements",
    "interior_renovation:confirm_accessibility_requirements",
    "interior_renovation:confirm_occupied_building_restrictions",
    "interior_renovation:photograph_existing_conditions",
    "interior_renovation:confirm_finish_schedule",
    "interior_renovation:confirm_paint_colors",
  ],
  "interior_renovation:interior_permit_documents": [
    "interior_renovation:confirm_permit_disciplines",
    "interior_renovation:gather_arch_eng_plans",
    "interior_renovation:gather_product_approvals",
  ],
  "interior_renovation:order_materials_and_subcontracts": [
    "interior_renovation:confirm_long_lead_items",
    "interior_renovation:obtain_subcontractor_proposals",
    "interior_renovation:issue_pos_and_subcontracts",
    "interior_renovation:confirm_cabinets_countertops",
    "interior_renovation:confirm_doors_hardware",
    "interior_renovation:confirm_plumbing_fixtures",
    "interior_renovation:confirm_electrical_fixtures",
    "interior_renovation:confirm_flooring",
    "interior_renovation:establish_delivery_schedule",
    "interior_renovation:confirm_material_storage_location",
  ],
  "interior_renovation:safety_and_site_readiness": [
    "interior_renovation:conduct_precon_meeting",
    "interior_renovation:confirm_access_working_hours",
    "interior_renovation:confirm_dust_occupied_protection",
    "interior_renovation:confirm_temporary_utilities",
    "interior_renovation:confirm_dumpster_debris_plan",
    "interior_renovation:confirm_safety_plan",
    "interior_renovation:establish_baseline_schedule",
  ],
  "interior_renovation:mobilize_and_demolish": [
    "interior_renovation:mobilize_install_protection",
    "interior_renovation:complete_demolition",
    "interior_renovation:document_concealed_conditions",
  ],
  "interior_renovation:framing_and_rough_ins": [
    "interior_renovation:complete_structural_framing",
    "interior_renovation:complete_plumbing_rough_in",
    "interior_renovation:complete_electrical_rough_in",
    "interior_renovation:complete_hvac_rough_in",
    "interior_renovation:complete_fire_protection_rough_in",
  ],
  "interior_renovation:rough_inspections": ["interior_renovation:obtain_rough_inspections"],
  "interior_renovation:insulation_inspection": ["interior_renovation:obtain_insulation_inspection"],
  "interior_renovation:drywall_and_paint": [
    "interior_renovation:install_insulation",
    "interior_renovation:install_drywall",
    "interior_renovation:complete_drywall_finishing",
    "interior_renovation:prime_and_paint",
  ],
  "interior_renovation:install_finishes": [
    "interior_renovation:install_cabinets_countertops",
    "interior_renovation:install_flooring",
    "interior_renovation:install_doors_trim_hardware",
    "interior_renovation:complete_plumbing_trim_out",
    "interior_renovation:complete_electrical_trim_out",
    "interior_renovation:complete_hvac_trim_out",
    "interior_renovation:complete_final_finishes",
    "interior_renovation:perform_internal_quality_review",
  ],

  // ── Code Violation ─────────────────────────────────────────────────────
  "code_violation:assign_case_manager": ["code_violation:assign_case_manager"],
  "code_violation:review_notice": [
    "code_violation:upload_review_notice",
    "code_violation:confirm_property_case_details",
    "code_violation:confirm_deadlines_inspections_hearings",
    "code_violation:determine_fine_accrual",
  ],
  "code_violation:create_violation_items": ["code_violation:create_violation_items"],
  "code_violation:contact_code_officer": ["code_violation:contact_code_officer", "code_violation:confirm_official_status_balance"],
  "code_violation:inspect_site": [
    "code_violation:schedule_site_access_inspection",
    "code_violation:conduct_site_inspection",
    "code_violation:upload_before_photos",
    "code_violation:document_each_item",
    "code_violation:identify_responsible_trades",
    "code_violation:identify_emergency_conditions",
  ],
  "code_violation:secure_site_emergency": ["code_violation:secure_site_emergency"],
  "code_violation:prepare_preliminary_scope_budget": ["code_violation:determine_prior_unpermitted_work", "code_violation:prepare_preliminary_scope_budget"],
  "code_violation:decide_strategy": [
    "code_violation:decide_strategy",
    "code_violation:request_document_extension",
    "code_violation:determine_professional_assistance",
  ],
  "code_violation:obtain_management_owner_approval": [
    "code_violation:obtain_management_owner_approval",
    "code_violation:obtain_proposals_or_assign_crews",
    "code_violation:approve_scope_budget",
  ],
  "code_violation:file_appeal": ["code_violation:file_appeal"],
  "code_violation:determine_permit_requirement": ["code_violation:determine_permit_requirement"],
  "code_violation:confirm_permit_submitted": [
    "code_violation:confirm_permit_jurisdiction",
    "code_violation:confirm_licensing_insurance",
    "code_violation:obtain_plans_engineering_approvals",
    "code_violation:confirm_permit_submitted",
  ],
  "code_violation:confirm_permit_issued": [
    "code_violation:confirm_permit_issued",
    "code_violation:upload_permit_to_case",
    "code_violation:confirm_permit_inspections_scheduled",
  ],
  "code_violation:close_permit": ["code_violation:close_permit", "code_violation:confirm_permits_closed"],
  "code_violation:verify_no_permit_required": [
    "code_violation:verify_no_permit_required",
    "code_violation:record_no_permit_confirmation",
    "code_violation:upload_no_permit_support",
  ],
  "code_violation:obtain_pm_approval_no_permit": ["code_violation:obtain_pm_approval_no_permit"],
  "code_violation:create_or_link_job": [
    "code_violation:create_or_link_job",
    "code_violation:apply_trade_workflow_on_job",
    "code_violation:confirm_materials_scheduling_on_job",
  ],
  "code_violation:corrective_work_complete": ["code_violation:corrective_work_complete"],
  "code_violation:submit_proof_of_correction": [
    "code_violation:mark_items_corrected",
    "code_violation:notify_code_officer",
    "code_violation:submit_proof_of_correction",
    "code_violation:request_reinspection",
    "code_violation:schedule_assign_reinspection",
  ],
  "code_violation:agency_reinspection": ["code_violation:agency_reinspection"],
  "code_violation:obtain_written_compliance_confirmation": [
    "code_violation:upload_inspection_report",
    "code_violation:obtain_written_compliance_confirmation",
    "code_violation:record_official_compliance_date",
  ],
  "code_violation:confirm_fines_stopped": ["code_violation:confirm_fines_stopped"],
  "code_violation:prepare_hearing_evidence": [
    "code_violation:calendar_hearing",
    "code_violation:assign_hearing_attendee",
    "code_violation:prepare_hearing_evidence",
    "code_violation:prepare_fine_mitigation_for_hearing",
  ],
  "code_violation:record_hearing_outcome": [
    "code_violation:record_hearing_outcome",
    "code_violation:upload_hearing_order",
    "code_violation:calendar_order_deadlines",
  ],
  "code_violation:confirm_official_balance": ["code_violation:confirm_official_balance"],
  "code_violation:obtain_payment_approval": [
    "code_violation:submit_mitigation_request",
    "code_violation:track_mitigation_decision",
    "code_violation:obtain_payment_approval",
  ],
  "code_violation:record_fine_payment": ["code_violation:record_fine_payment"],
  "code_violation:obtain_lien_release": ["code_violation:record_lien_details", "code_violation:obtain_lien_release"],
  "code_violation:confirm_all_items_complete": ["code_violation:confirm_all_items_complete", "code_violation:confirm_required_tasks_complete"],
  "code_violation:confirm_fines_liens_resolved": ["code_violation:confirm_fines_liens_resolved"],
  "code_violation:obtain_manager_close_approval": [
    "code_violation:reconcile_final_costs",
    "code_violation:upload_closeout_package",
    "code_violation:obtain_manager_close_approval",
  ],
  "code_violation:close_case": ["code_violation:close_case"],
};

const DAILY_LOGS = "Covered by daily logs and the daily-log follow-up task";
const PERMIT_FOLLOW_UPS = "Covered by the Permits tab's own follow-ups (confirm receipt, 7-day and 14-day aging, denied)";
const AUTO_CORRECTION = "Covered by the correction task raised automatically when an inspection fails";

/** v1 steps that go away entirely, with what covers them. */
export const SLIM_DROPPED: Record<string, string> = {
  "core:create_job_budget": "Covered by the schedule of values and job costing",
  "core:maintain_daily_documentation": DAILY_LOGS,
  "core:upload_progress_photos": DAILY_LOGS,
  "core:document_field_conditions": DAILY_LOGS,
  "core:monitor_schedule_dependencies": "Open-ended; covered by the workflow health widget and the production board",
  "core:approve_change_orders_before_work": "Covered by the change-order module; kept as a checklist line where extra work is found",
  "roofing:track_permit_review": PERMIT_FOLLOW_UPS,
  "roofing:respond_to_permit_comments": PERMIT_FOLLOW_UPS,
  "roofing:obtain_stored_material_docs": "Covered by progress billing",
  "roofing:complete_daily_reports_photos": DAILY_LOGS,
  "roofing:correct_failed_inspection_items": AUTO_CORRECTION,
  "doors_windows:track_plan_review": PERMIT_FOLLOW_UPS,
  "doors_windows:respond_to_permit_comments": PERMIT_FOLLOW_UPS,
  "doors_windows:complete_daily_reports_photos": DAILY_LOGS,
  "doors_windows:create_correction_tasks_failed": AUTO_CORRECTION,
  "interior_renovation:track_plan_review": PERMIT_FOLLOW_UPS,
  "interior_renovation:respond_to_permit_comments": PERMIT_FOLLOW_UPS,
  "interior_renovation:complete_daily_reports_photos": DAILY_LOGS,
  "interior_renovation:create_correction_tasks_failed": AUTO_CORRECTION,
  "code_violation:track_permit_comments": "Covered by the permit follow-ups on the linked job",
  "code_violation:confirm_agency_compliance": "Duplicate of the written-confirmation gate and of Close case's own check",
};

/** Streamlined steps with no v1 source: the two Core placeholders the trades override. */
export const SLIM_NEW_STEPS: readonly string[] = ["core:prepare_permit_documents", "core:complete_work"];

/** v1 scope toggle → streamlined toggle (several may map to one: OR them). `null` = gone. Unlisted modules are unchanged. */
export const SLIM_TOGGLE_MAP: Record<string, Record<string, string | null>> = {
  roofing: {
    tear_off: "tear_off",
    deck_repairs: "deck_repairs",
    insulation: "low_slope",
    tpo: "low_slope",
    pvc: "low_slope",
    mod_bit: "low_slope",
    coating: "low_slope",
    metal: null,
    crane: "crane",
    mfr_warranty: "mfr_warranty",
    occupied: "occupied",
  },
  doors_windows: {
    windows: "windows",
    exterior_doors: "exterior_doors",
    interior_doors: null,
    storefront: "storefront",
    impact: "impact",
    non_impact: null,
    interior_restoration: "restoration",
    exterior_restoration: "restoration",
    engineering: "engineering",
  },
};

/** v1 phase → streamlined phase, for the manual and correction tasks that sit in a phase. Identity when unlisted. */
export const SLIM_PHASE_MAP: Record<string, string> = {
  "core:preconstruction": "core:job_setup",
  ...Object.fromEntries(
    T.flatMap((t) => [
      [`${t}:permit_required`, "core:permit_required"],
      [`${t}:no_permit`, "core:no_permit"],
      [`${t}:production_readiness`, `${t}:procurement`],
      [`${t}:closeout`, "core:closeout"],
    ]),
  ),
};

/** v1 full key → where it went. */
export type SlimDestination = { to: string } | { dropped: string };

export function slimDestinationOf(v1FullKey: string): SlimDestination | null {
  for (const [to, from] of Object.entries(SLIM_ABSORBS)) if (from.includes(v1FullKey)) return { to };
  const dropped = SLIM_DROPPED[v1FullKey];
  return dropped ? { dropped } : null;
}
