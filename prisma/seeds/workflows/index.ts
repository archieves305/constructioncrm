import type { TemplateDefinition } from "../../../src/lib/workflows/templates/types";
import { CORE as CORE_V1 } from "./v1/core";
import { ROOFING as ROOFING_V1 } from "./v1/roofing";
import { INTERIOR_RENOVATION as INTERIOR_RENOVATION_V1 } from "./v1/interior-renovation";
import { DOORS_WINDOWS as DOORS_WINDOWS_V1 } from "./v1/doors-windows";
import { CODE_VIOLATION as CODE_VIOLATION_V1 } from "./v1/code-violation";
import { CORE } from "./v2/core";
import { ROOFING } from "./v2/roofing";
import { INTERIOR_RENOVATION } from "./v2/interior-renovation";
import { DOORS_WINDOWS } from "./v2/doors-windows";
import { CODE_VIOLATION } from "./v2/code-violation";

/**
 * Every seeded template, Core first, as GENERATIONS of content, oldest
 * first.
 *
 * Generation 1 (`v1/`) is the original long-form workflow. Jobs and cases
 * pin it, so its content is frozen: the files moved, nothing in them
 * changed, and seed-specs.test.ts pins their hashes. Generation 2 (`v2/`)
 * is the streamlined "milestone" workflow new jobs get.
 *
 * A generation is identified by its content hash, not by a version number —
 * the admin editor also mints version numbers, so "v2" on one database may
 * be somebody's edited draft. The seeder gives a new generation the next
 * free number and makes it the one published version.
 */
export type SeedGeneration = {
  /** 1 = the original long-form workflow, 2 = streamlined. */
  generation: number;
  definition: TemplateDefinition;
};

export type SeededTemplate = { key: string; generations: readonly SeedGeneration[] };

const template = (v1: TemplateDefinition, v2: TemplateDefinition): SeededTemplate => ({
  key: v2.key,
  generations: [
    { generation: 1, definition: v1 },
    { generation: 2, definition: v2 },
  ],
});

export const WORKFLOW_SEED_GENERATIONS: readonly SeededTemplate[] = [
  template(CORE_V1, CORE),
  template(ROOFING_V1, ROOFING),
  template(INTERIOR_RENOVATION_V1, INTERIOR_RENOVATION),
  template(DOORS_WINDOWS_V1, DOORS_WINDOWS),
  template(CODE_VIOLATION_V1, CODE_VIOLATION),
];

/** The original long-form specs, frozen. */
export const WORKFLOW_V1_SPECS: readonly TemplateDefinition[] = WORKFLOW_SEED_GENERATIONS.map((t) => t.generations[0]!.definition);

/** The streamlined specs a new job or case gets. */
export const WORKFLOW_TEMPLATE_SPECS: readonly TemplateDefinition[] = WORKFLOW_SEED_GENERATIONS.map((t) => t.generations.at(-1)!.definition);
