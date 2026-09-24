import type { TemplateDefinition } from "../../../src/lib/workflows/templates/types";
import { CORE } from "./core";
import { ROOFING } from "./roofing";
import { INTERIOR_RENOVATION } from "./interior-renovation";
import { DOORS_WINDOWS } from "./doors-windows";

/** Every seeded template, Core first. Each is version 1 until a spec changes. */
export const WORKFLOW_TEMPLATE_SPECS: readonly TemplateDefinition[] = [CORE, ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS];

export const WORKFLOW_TEMPLATE_VERSION = 1;
