// Pure, DB-free definitions of the seed estimate templates. Imported by the
// seed module (prisma/seed-estimate-templates.ts) and the seed-integrity test.
// Section/item order is the array order; the seeder assigns sortOrder by index.

import {
  ESTIMATE_TEMPLATE_CATEGORIES,
  ESTIMATE_UNIT_TYPES,
} from "@/lib/estimates/generic-schema";

export type TemplateUnitType = (typeof ESTIMATE_UNIT_TYPES)[number];
export type TemplateCategory = (typeof ESTIMATE_TEMPLATE_CATEGORIES)[number];

export type TemplateLineItemDef = {
  description: string;
  unitType: TemplateUnitType;
  isOptional?: boolean;
  defaultQuantity?: number;
  defaultUnitPrice?: number;
  defaultNotes?: string;
};

export type TemplateSectionDef = {
  title: string;
  items: TemplateLineItemDef[];
};

export type TemplateDef = {
  key: string;
  category: TemplateCategory;
  name: string;
  sections: TemplateSectionDef[];
};

const NOTES_SECTION: TemplateSectionDef = {
  title: "Notes / Exclusions",
  items: [
    {
      description: "Notes / exclusions",
      unitType: "LUMP_SUM",
      isOptional: true,
      defaultNotes:
        "List any clarifications, assumptions, or work explicitly excluded from this estimate.",
    },
  ],
};

// ── Roofing: routing placeholder only ───────────────────────────────────────
// Roofing leads open the existing specialized roofing form, so this template is
// never rendered in the generic builder — it exists for the picker label.
const ROOFING: TemplateDef = {
  key: "roofing",
  category: "ROOFING",
  name: "Roofing",
  sections: [{ title: "Roofing", items: [] }],
};

// ── Drywall ─────────────────────────────────────────────────────────────────
const DRYWALL: TemplateDef = {
  key: "drywall",
  category: "DRYWALL",
  name: "Drywall",
  sections: [
    {
      title: "Demolition & Removal",
      items: [
        { description: "Demo / removal of existing drywall", unitType: "SQ_FT" },
        { description: "Cleanup & haul-away", unitType: "LUMP_SUM" },
        { description: "Cleanup labor", unitType: "LABOR_HOUR" },
      ],
    },
    {
      title: "Drywall Hanging",
      items: [
        { description: "Standard drywall hanging", unitType: "SHEET" },
        { description: "Ceiling drywall", unitType: "SHEET" },
        { description: "Moisture-resistant drywall", unitType: "SHEET" },
        { description: "Fire-rated drywall", unitType: "SHEET" },
      ],
    },
    {
      title: "Finishing",
      items: [
        { description: "Corner bead", unitType: "LINEAR_FT" },
        { description: "Joint tape & mud", unitType: "SQ_FT" },
        { description: "Finishing — Level 3", unitType: "SQ_FT", isOptional: true },
        { description: "Finishing — Level 4", unitType: "SQ_FT" },
        { description: "Finishing — Level 5", unitType: "SQ_FT", isOptional: true },
        { description: "Sanding", unitType: "SQ_FT" },
        { description: "Texture", unitType: "SQ_FT", isOptional: true },
      ],
    },
    {
      title: "Paint Prep & Paint",
      items: [
        { description: "Primer", unitType: "SQ_FT" },
        { description: "Paint", unitType: "SQ_FT", isOptional: true },
      ],
    },
    {
      title: "Labor & Materials",
      items: [
        { description: "Labor", unitType: "LABOR_HOUR" },
        { description: "Materials", unitType: "LUMP_SUM" },
        {
          description: "Waste factor",
          unitType: "LUMP_SUM",
          defaultNotes: "Allowance for cut-offs and breakage.",
        },
      ],
    },
    {
      title: "Permits & Cleanup",
      items: [
        { description: "Permit", unitType: "EACH", isOptional: true },
      ],
    },
    NOTES_SECTION,
  ],
};

// ── Interior Renovation ─────────────────────────────────────────────────────
const INTERIOR_RENOVATION: TemplateDef = {
  key: "interior-renovation",
  category: "INTERIOR_RENOVATION",
  name: "Interior Renovation",
  sections: [
    {
      title: "General Conditions",
      items: [
        { description: "General conditions", unitType: "LUMP_SUM" },
        { description: "Project management / supervision", unitType: "LUMP_SUM" },
        { description: "Site protection", unitType: "LUMP_SUM" },
        { description: "Permit / inspections", unitType: "EACH" },
      ],
    },
    {
      title: "Demolition",
      items: [
        {
          description: "Demolition",
          unitType: "ROOM",
          defaultNotes:
            "Duplicate this section per room for room-by-room scope.",
        },
        { description: "Debris removal", unitType: "LUMP_SUM" },
      ],
    },
    {
      title: "Framing & Drywall",
      items: [
        { description: "Framing", unitType: "LINEAR_FT" },
        { description: "Drywall", unitType: "SQ_FT" },
      ],
    },
    {
      title: "Doors, Trim & Carpentry",
      items: [
        { description: "Doors", unitType: "EACH" },
        { description: "Trim / baseboards", unitType: "LINEAR_FT" },
        { description: "Finish carpentry", unitType: "LABOR_HOUR" },
      ],
    },
    {
      title: "Flooring & Tile",
      items: [
        { description: "Flooring", unitType: "SQ_FT" },
        { description: "Tile", unitType: "SQ_FT" },
      ],
    },
    {
      title: "Painting",
      items: [{ description: "Painting", unitType: "SQ_FT" }],
    },
    {
      title: "MEP Allowances",
      items: [
        { description: "Electrical allowance", unitType: "LUMP_SUM" },
        { description: "Plumbing allowance", unitType: "LUMP_SUM" },
        { description: "HVAC allowance", unitType: "LUMP_SUM" },
      ],
    },
    {
      title: "Kitchen",
      items: [
        { description: "Kitchen work", unitType: "LUMP_SUM" },
        { description: "Cabinets", unitType: "LINEAR_FT" },
        { description: "Countertops", unitType: "SQ_FT" },
        { description: "Fixtures", unitType: "EACH" },
      ],
    },
    {
      title: "Bathroom",
      items: [
        { description: "Bathroom work", unitType: "LUMP_SUM" },
        { description: "Fixtures", unitType: "EACH" },
      ],
    },
    {
      title: "Closeout",
      items: [
        { description: "Final cleaning", unitType: "LUMP_SUM" },
        {
          description: "Contingency / allowance",
          unitType: "LUMP_SUM",
          isOptional: true,
        },
      ],
    },
    NOTES_SECTION,
  ],
};

// ── Windows & Doors ─────────────────────────────────────────────────────────
const WINDOWS_DOORS: TemplateDef = {
  key: "windows-doors",
  category: "WINDOWS_DOORS",
  name: "Windows & Doors",
  sections: [
    {
      title: "Removal",
      items: [
        { description: "Window removal", unitType: "OPENING" },
        { description: "Door removal", unitType: "OPENING" },
        { description: "Disposal", unitType: "LUMP_SUM" },
      ],
    },
    {
      title: "Windows",
      items: [
        { description: "New window installation", unitType: "OPENING" },
        { description: "Impact windows", unitType: "OPENING" },
        { description: "Sliding glass doors", unitType: "OPENING" },
      ],
    },
    {
      title: "Doors",
      items: [
        { description: "New exterior door installation", unitType: "EACH" },
        { description: "New interior door installation", unitType: "EACH" },
        { description: "Impact doors", unitType: "EACH" },
        { description: "French doors", unitType: "EACH" },
        {
          description: "Storefront / commercial doors",
          unitType: "EACH",
          isOptional: true,
        },
      ],
    },
    {
      title: "Prep & Repair",
      items: [
        { description: "Bucks / framing repair", unitType: "OPENING" },
        { description: "Flashing", unitType: "OPENING" },
        { description: "Sealant", unitType: "OPENING" },
        { description: "Trim / casing", unitType: "LINEAR_FT" },
        { description: "Stucco or drywall patching", unitType: "SQ_FT" },
        { description: "Painting touch-up", unitType: "LUMP_SUM" },
      ],
    },
    {
      title: "Hardware & Permits",
      items: [
        { description: "Hardware", unitType: "EACH" },
        { description: "Permit / NOA / product approval", unitType: "EACH" },
      ],
    },
    {
      title: "Labor & Materials",
      items: [
        { description: "Labor", unitType: "LABOR_HOUR" },
        { description: "Materials", unitType: "LUMP_SUM" },
      ],
    },
    NOTES_SECTION,
  ],
};

export const TEMPLATE_DEFS: TemplateDef[] = [
  ROOFING,
  DRYWALL,
  INTERIOR_RENOVATION,
  WINDOWS_DOORS,
];
