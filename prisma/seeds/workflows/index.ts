import type { TemplateDefinition } from "../../../src/lib/workflows/templates/types";
import { CORE } from "./core";
import { ROOFING } from "./roofing";
import { INTERIOR_RENOVATION } from "./interior-renovation";
import { DOORS_WINDOWS } from "./doors-windows";
import { CODE_VIOLATION } from "./code-violation";

/**
 * Every seeded template, Core first. Each is version 1 until a spec changes.
 * The four construction templates are pinned by live jobs and their content
 * is frozen (see seed-specs.test.ts); the violation template composes alone.
 */
export const WORKFLOW_TEMPLATE_SPECS: readonly TemplateDefinition[] = [CORE, ROOFING, INTERIOR_RENOVATION, DOORS_WINDOWS, CODE_VIOLATION];

export const WORKFLOW_TEMPLATE_VERSION = 1;
