/**
 * What an inspection can be, the quality bars, and the trades with a short
 * "what to look for" list each. Pure, client-safe.
 *
 * The look-for lists are a STARTER DRAFT (ruling 9, 2026-11-25): plain
 * workmanship cues written for a person walking a property, to be read and
 * corrected by Richard or a PM before anyone relies on them. They name no
 * building-code section, manufacturer figure or tolerance, on purpose. They
 * steer the AI's attention; they are not a checklist of passes.
 */
export const INSPECTION_KINDS = [
  "QUICK",
  "COMPLETION",
  "TURNOVER",
  "INTERIOR",
  "EXTERIOR",
  "TRADE",
  "PROGRESS",
  "MAINTENANCE",
  "PRE_CONCEALMENT",
  "WARRANTY",
] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

export const KIND_LABEL: Record<InspectionKind, string> = {
  QUICK: "Quick inspection",
  COMPLETION: "Contractor completion",
  TURNOVER: "Tenant turnover / rent-ready",
  INTERIOR: "Interior renovation",
  EXTERIOR: "Exterior renovation",
  TRADE: "Trade inspection",
  PROGRESS: "Progress",
  MAINTENANCE: "Maintenance / handyman",
  PRE_CONCEALMENT: "Before it is covered",
  WARRANTY: "Warranty / callback",
};

/** What the AI should weigh for each kind (one line in the prompt). */
export const KIND_FOCUS: Record<InspectionKind, string> = {
  QUICK: "General workmanship review of whatever the photos show.",
  COMPLETION: "Is the contractor's work finished and acceptable to accept? Look for unfinished work and defects a contractor should fix before leaving.",
  TURNOVER: "Is the unit rent-ready? Look for damage, incomplete repairs, missing hardware or covers, dirt and debris, and anything a new tenant would complain about.",
  INTERIOR: "Interior renovation finish quality: drywall, paint, flooring, trim, cabinets, tile, fixtures.",
  EXTERIOR: "Exterior work: siding, stucco, paint, trim, windows and doors, roofing edges, gutters, grading.",
  TRADE: "Workmanship of the named trade.",
  PROGRESS: "Document what is done so far and anything done wrong; unfinished work is expected and is not a defect unless it is done wrong.",
  MAINTENANCE: "Is the repair done, working where visible, and tidy?",
  PRE_CONCEALMENT: "Work about to be covered (framing, plumbing, electrical, waterproofing, insulation): visible gaps, damage or missing pieces. Concealed work's correctness needs a physical check or an inspector.",
  WARRANTY: "The reported problem: is it visible, and what does it look like?",
};

export const QUALITY_PROFILES = ["maintenance", "rental", "retail", "standard", "luxury"] as const;
export type QualityProfile = (typeof QUALITY_PROFILES)[number];

export const PROFILE_LABEL: Record<QualityProfile, string> = {
  maintenance: "Maintenance grade",
  rental: "Rental grade",
  retail: "Retail resale grade",
  standard: "Standard construction",
  luxury: "Luxury renovation",
};

/** The bar, as told to the AI. A profile never relaxes safety. */
export const PROFILE_BAR: Record<QualityProfile, string> = {
  maintenance: "Functional and reasonably neat. Cosmetic flaws that do not affect use are COSMETIC at most.",
  rental: "Clean, durable and consistent; rent-ready. Small cosmetic flaws a tenant would notice are MINOR.",
  retail: "Market-ready for a retail buyer's walkthrough: visible cosmetic flaws in main rooms are MINOR or MAJOR.",
  standard: "Workmanlike to the project's scope; visible cosmetic flaws are MINOR.",
  luxury: "Premium finish: crisp lines, tight joints, no visible flaws in finished surfaces. Visible finish flaws are MAJOR.",
};

export function isQualityProfile(v: unknown): v is QualityProfile {
  return typeof v === "string" && (QUALITY_PROFILES as readonly string[]).includes(v);
}

/** The default bar: an owned rental at rental grade, an owned flip at retail, everything else standard. */
export function defaultProfile(job: { jobType?: string | null; ownedPurpose?: string | null } | null): QualityProfile {
  if (job?.jobType === "OWNED_REHAB") return job.ownedPurpose === "RENTAL" ? "rental" : "retail";
  return "standard";
}

export type Trade = { key: string; label: string; lookFor: readonly string[] };

export const TRADES: readonly Trade[] = [
  { key: "painting", label: "Painting", lookFor: ["uneven coverage, thin spots or flashing", "roller marks, brush marks, drips, runs", "paint on trim, outlets, switches, hardware, floors or glass", "ragged cut lines at ceilings, trim and corners", "visible patches, unfilled holes or cracks", "missed areas"] },
  { key: "drywall", label: "Drywall", lookFor: ["visible seams, tape lines or ridges", "fastener pops or unfilled screw holes", "damaged, crushed or torn board", "rough or wavy corners and beads", "texture that does not match", "surface bumps or dents visible in raking light"] },
  { key: "flooring", label: "Flooring", lookFor: ["gaps between planks or tiles", "chipped, scratched or damaged pieces", "uneven or missing transitions", "rough cuts at door frames and walls", "missing baseboard or quarter round", "buckling, cupping or lifting"] },
  { key: "tile", label: "Tile", lookFor: ["uneven grout lines or missing grout", "edges of neighbouring tiles not level (suspected lippage)", "cracked or chipped tile", "poor or missing caulk at changes of plane", "rough cuts around fixtures and penetrations", "uneven layout or tiny slivers at edges"] },
  { key: "shower_waterproofing", label: "Shower / waterproofing", lookFor: ["visible gaps, tears or missed areas in the membrane", "membrane not lapped at corners, niches, benches or the curb", "penetrations not sealed", "drain area unfinished", "anything that needs a flood test to settle"] },
  { key: "cabinetry", label: "Cabinets", lookFor: ["doors or drawer fronts out of line or uneven gaps", "hardware crooked or missing", "missing filler panels, scribes or toe kicks", "chipped or scratched finish", "gaps to walls or ceilings left unfinished"] },
  { key: "countertops", label: "Countertops", lookFor: ["visible or uneven seams", "chips or scratches", "missing or messy caulk at the backsplash and sink", "exposed unfinished edges", "overhangs uneven"] },
  { key: "finish_carpentry", label: "Trim / finish carpentry", lookFor: ["open miters or gaps at joints", "nail holes not filled", "caulk missing or messy", "trim missing, split or out of line", "doors rubbing or uneven gaps"] },
  { key: "plumbing", label: "Plumbing fixtures", lookFor: ["fixtures loose, crooked or missing parts", "escutcheons or trim plates missing", "supply lines or traps visibly damaged or leaking (stains, drips)", "caulk missing at fixture bases", "anything needing a water / function test"] },
  { key: "electrical", label: "Electrical (visible)", lookFor: ["missing or broken cover plates", "devices crooked or loose", "exposed wires or open boxes", "fixtures missing bulbs or globes", "anything needing a power / function test"] },
  { key: "hvac", label: "HVAC (visible)", lookFor: ["registers and returns missing, loose or dirty", "visible duct damage", "condensate or water stains", "filter missing or dirty", "performance needs a function test"] },
  { key: "doors_windows", label: "Doors & windows", lookFor: ["frames out of square or gaps", "missing or damaged hardware, locks or stops", "broken glass, torn screens", "perimeter caulk or trim missing", "damaged sills or jambs"] },
  { key: "roofing", label: "Roofing", lookFor: ["lifted, buckled or misaligned shingles", "exposed fasteners", "damaged or missing pieces", "flashing at walls, valleys and penetrations that looks unfinished", "edges, drip edge and rakes incomplete", "debris left on the roof or in gutters"] },
  { key: "stucco_siding", label: "Stucco / siding", lookFor: ["cracks or inconsistent stucco texture", "siding uneven, gaps or loose pieces", "missing trim or caulk at openings", "damaged fascia or soffit", "possible water entry points"] },
  { key: "exterior_paint", label: "Exterior paint", lookFor: ["missed areas or thin coverage", "paint on glass, hardware or landscaping", "peeling or blistering", "poor cut lines at trim"] },
  { key: "concrete_pavers", label: "Concrete / driveways / pavers", lookFor: ["cracks", "uneven or settled pavers", "rough or unfinished edges", "ponding or poor slope (suspected)", "debris left"] },
  { key: "landscaping", label: "Landscaping / fencing", lookFor: ["dead or missing plants", "beds not edged or mulched", "debris left", "fence boards or gates broken, leaning or not latching"] },
  { key: "appliances", label: "Appliances", lookFor: ["dirty inside or out", "dents, scratches or missing parts", "not installed level or not pushed in", "function needs a test"] },
  { key: "cleaning", label: "Cleaning", lookFor: ["dust, dirt or construction debris", "stickers, labels or protective film left on", "dirty windows, fixtures or appliances", "paint or grout haze"] },
  { key: "general", label: "General / handyman", lookFor: ["work left unfinished", "damage caused by the work", "missing hardware, covers or trim", "mess or debris left"] },
];

export const TRADE_KEYS: readonly string[] = TRADES.map((t) => t.key);

export function tradeLabel(key: string | null | undefined): string {
  if (!key) return "General";
  return TRADES.find((t) => t.key === key)?.label ?? key;
}

export function isTradeKey(v: unknown): v is string {
  return typeof v === "string" && TRADE_KEYS.includes(v);
}
