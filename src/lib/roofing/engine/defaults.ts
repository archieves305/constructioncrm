import type { RoofType } from "../types";

// Default takeoff rules. These seed the editable `estimate_rules` table and are
// also the fallback the engine uses when a rule row is missing. Coefficients are
// industry rules-of-thumb; the calibration layer refines them from real invoices.
//
// `kind` controls how `value` is applied to `inputMetric`:
//   per_square      qty = metric * value           (metric in squares)
//   squares_per_unit qty = metric / value           (one unit covers `value` squares)
//   per_lf          qty = metric * value           (metric in linear feet)
//   lf_per_unit     qty = metric / value           (one unit covers `value` linear feet)
//   per_count       qty = metric * value
//   per_facet       qty = metric * value
//   fixed           qty = value
//   waste_pct       roof-level waste factor (0..1), not a line item

export type RuleKind =
  | "per_square"
  | "squares_per_unit"
  | "per_lf"
  | "lf_per_unit"
  | "per_count"
  | "per_facet"
  | "fixed"
  | "waste_pct";

export interface RuleDef {
  key: string;
  roofType: RoofType | null;
  label: string;
  category: string;
  description?: string;
  kind: RuleKind;
  inputMetric?: string; // key into the derived metric map
  value: number;
  unit?: string;
  params?: Record<string, unknown>;
}

export const DEFAULT_RULES: RuleDef[] = [
  // ── Waste factors ──────────────────────────────────────────────────────
  { key: "shingle.waste_pct", roofType: "SHINGLE", label: "Shingle waste factor", category: "Waste", kind: "waste_pct", value: 0.1, description: "Default 10%; steeper/cut-up roofs trend higher." },
  { key: "tile.waste_pct", roofType: "TILE", label: "Tile waste factor", category: "Waste", kind: "waste_pct", value: 0.12 },
  { key: "metal.waste_pct", roofType: "METAL", label: "Metal waste factor", category: "Waste", kind: "waste_pct", value: 0.08 },

  // ── Shingle ────────────────────────────────────────────────────────────
  // Coefficients calibrated against 20+ KNU/SRS Roofr reports + supplier orders
  // (see estimates/CALIBRATION.md). Roofr's own material calc + SRS quotes are
  // the ground truth for what KNU actually orders.
  { key: "shingle.field.bundles_per_square", roofType: "SHINGLE", label: "Field shingle bundles per square", category: "Shingles", kind: "per_square", inputMetric: "totalSquares", value: 3, unit: "bundle", description: "Calibrated: 3.05 bundles/sq across reports." },
  { key: "shingle.starter.lf_per_bundle", roofType: "SHINGLE", label: "Starter shingle coverage (lf/bundle)", category: "Starter", kind: "lf_per_unit", inputMetric: "starterLf", value: 100, unit: "bundle", description: "Calibrated to ~100 lf/bundle (Roofr/SRS orders); product spec is 120-123 lf/bd." },
  { key: "shingle.ridgecap.lf_per_bundle", roofType: "SHINGLE", label: "Ridge cap coverage (lf/bundle)", category: "Ridge Cap", kind: "lf_per_unit", inputMetric: "ridgesHipsLf", value: 23, unit: "bundle", description: "Calibrated: 23 lf/bundle (GAF Seal-A-Ridge / IKO H&R 12; was 35)." },
  { key: "shingle.underlayment.squares_per_roll", roofType: "SHINGLE", label: "Synthetic underlayment (squares/roll)", category: "Underlayment", kind: "squares_per_unit", inputMetric: "totalSquares", value: 9, unit: "roll", description: "Calibrated: ~9 sq/roll effective (10 sq roll w/ minimal laps)." },
  { key: "shingle.icewater.lf_per_roll", roofType: "SHINGLE", label: "Ice & water shield coverage (lf/roll)", category: "Ice & Water", kind: "lf_per_unit", inputMetric: "iceWaterLf", value: 62, unit: "roll", description: "Calibrated: ~62 lf/roll; applied along eaves + valleys + flashings (Roofr basis)." },
  { key: "shingle.dripedge.lf_per_piece", roofType: "SHINGLE", label: "Drip edge (10' sheets)", category: "Drip Edge", kind: "lf_per_unit", inputMetric: "dripEdgeLf", value: 10, unit: "piece", description: "Calibrated: 10' sheets along eaves + rakes." },
  { key: "shingle.valleymetal.lf_per_sheet", roofType: "SHINGLE", label: "Valley metal (8' sheets)", category: "Valley", kind: "lf_per_unit", inputMetric: "valleysLf", value: 8, unit: "sheet", description: "Calibrated: 8' valley sheets (~7.7 lf effective w/ laps); was 50' rolls." },
  { key: "shingle.pipeboots.per_penetration", roofType: "SHINGLE", label: "Pipe boots per penetration", category: "Flashing", kind: "per_count", inputMetric: "penetrations", value: 1, unit: "each" },
  { key: "shingle.vents.squares_per_vent", roofType: "SHINGLE", label: "Box vents (squares/vent)", category: "Ventilation", kind: "squares_per_unit", inputMetric: "totalSquares", value: 10, unit: "each" },
  { key: "shingle.nails.squares_per_box", roofType: "SHINGLE", label: "Coil nails (squares/box)", category: "Fasteners", kind: "squares_per_unit", inputMetric: "totalSquares", value: 20, unit: "box" },
  { key: "shingle.sealant.squares_per_tube", roofType: "SHINGLE", label: "Sealant (squares/tube)", category: "Sealant", kind: "squares_per_unit", inputMetric: "totalSquares", value: 10, unit: "tube" },
  { key: "shingle.stepflashing.pieces_per_lf", roofType: "SHINGLE", label: "Step flashing pieces per lf", category: "Flashing", kind: "per_lf", inputMetric: "stepFlashingLf", value: 2, unit: "piece" },

  // ── Tile ────────────────────────────────────────────────────────────────
  // Tile calibrated against matched SRS Eagle tile orders (2044 Wightman, 401 NW
  // 3rd, 212 Florence, 104 Mirabella) — see estimates/CALIBRATION.md.
  { key: "tile.field.tiles_per_square", roofType: "TILE", label: "Field tile per square", category: "Field Tile", kind: "per_square", inputMetric: "totalSquares", value: 90, unit: "piece", description: "Calibrated: Eagle Bel Air 88.5 pc/sq base; flat/concrete ~90. Profile-dependent." },
  { key: "tile.ridge.pieces_per_lf", roofType: "TILE", label: "Ridge/hip tile per lf (hips + ridges)", category: "Ridge Tile", kind: "per_lf", inputMetric: "ridgesHipsLf", value: 1.1, unit: "piece", description: "Calibrated: ~1.1 pc/lf of hips+ridges (one ridge-tile SKU covers both)." },
  { key: "tile.hip.pieces_per_lf", roofType: "TILE", label: "Hip tile per lf (folded into ridge)", category: "Hip Tile", kind: "per_lf", inputMetric: "hipsLf", value: 0, unit: "piece", description: "Disabled by default — suppliers order one ridge-tile SKU for hips + ridges via tile.ridge." },
  { key: "tile.birdstop.lf_per_piece", roofType: "TILE", label: "Bird stop / eave closure (10' pieces)", category: "Eave Closure", kind: "lf_per_unit", inputMetric: "eavesLf", value: 9.5, unit: "piece", description: "Calibrated: ~9.5 lf/piece (10' eave riser/bird stop, ~9 lf effective); was 1." },
  { key: "tile.raketile.pieces_per_lf", roofType: "TILE", label: "Rake tile per lf", category: "Rake Tile", kind: "per_lf", inputMetric: "rakesLf", value: 1.3, unit: "piece", description: "Calibrated: 1.30 pc/lf on both Eagle Bel Air orders (2044 Wightman 24pc/18.4lf, 104 Mirabella 23pc/17.7lf). Eagle profiles only — Boral/Newpoint use a 3-sided ridge and order no rake tile." },
  { key: "tile.battens.lf_per_square", roofType: "TILE", label: "Batten lineal ft per square", category: "Battens", kind: "per_square", inputMetric: "totalSquares", value: 100, unit: "lf", description: "Only when battens are used (battenInstall=true)." },
  { key: "tile.underlayment.squares_per_roll", roofType: "TILE", label: "Tile underlayment (squares/roll)", category: "Underlayment", kind: "squares_per_unit", inputMetric: "totalSquares", value: 2, unit: "roll", description: "High-temp peel/stick is lower-coverage than synthetic." },
  { key: "tile.valleymetal.lf_per_sheet", roofType: "TILE", label: "Valley metal (8' sheets)", category: "Valley", kind: "lf_per_unit", inputMetric: "valleysLf", value: 8, unit: "sheet", description: "8' valley sheets (~7.7 lf effective w/ laps)." },
  { key: "tile.dripedge.lf_per_piece", roofType: "TILE", label: "Drip edge (lf/piece)", category: "Drip Edge", kind: "lf_per_unit", inputMetric: "dripEdgeLf", value: 10, unit: "piece" },
  { key: "tile.screws.tiles_per_box", roofType: "TILE", label: "Tile screws (tiles/box)", category: "Fasteners", kind: "fixed", value: 0, unit: "box", description: "Derived from field tile count at estimate time." },
  { key: "tile.foam.squares_per_unit", roofType: "TILE", label: "Tile adhesive/foam (squares/unit)", category: "Adhesive", kind: "squares_per_unit", inputMetric: "totalSquares", value: 4, unit: "each" },
  { key: "tile.pipeflashings.per_penetration", roofType: "TILE", label: "Tile pipe flashings per penetration", category: "Flashing", kind: "per_count", inputMetric: "penetrations", value: 1, unit: "each" },
  { key: "tile.vents.squares_per_vent", roofType: "TILE", label: "Tile vents (squares/vent)", category: "Ventilation", kind: "squares_per_unit", inputMetric: "totalSquares", value: 12, unit: "each" },

  // ── Metal ─────────────────────────────────────────────────────────────
  { key: "metal.panels.sqft_per_panel", roofType: "METAL", label: "Metal panel coverage (sq ft/panel)", category: "Panels", kind: "fixed", value: 0, unit: "panel", description: "Computed from roof area ÷ (panel width × length); see params." , params: { panelWidthIn: 16, panelLengthFt: 12 } },
  { key: "metal.ridgecap.lf_per_piece", roofType: "METAL", label: "Ridge cap (lf/piece)", category: "Ridge Cap", kind: "lf_per_unit", inputMetric: "ridgesLf", value: 10, unit: "piece" },
  { key: "metal.hipcap.lf_per_piece", roofType: "METAL", label: "Hip cap (lf/piece)", category: "Hip Cap", kind: "lf_per_unit", inputMetric: "hipsLf", value: 10, unit: "piece" },
  { key: "metal.eavetrim.lf_per_piece", roofType: "METAL", label: "Eave trim (lf/piece)", category: "Eave Trim", kind: "lf_per_unit", inputMetric: "eavesLf", value: 10, unit: "piece" },
  { key: "metal.raketrim.lf_per_piece", roofType: "METAL", label: "Rake/gable trim (lf/piece)", category: "Rake Trim", kind: "lf_per_unit", inputMetric: "rakesLf", value: 10, unit: "piece" },
  { key: "metal.valleytrim.lf_per_piece", roofType: "METAL", label: "Valley trim (lf/piece)", category: "Valley Trim", kind: "lf_per_unit", inputMetric: "valleysLf", value: 10, unit: "piece" },
  { key: "metal.zbar.lf_per_piece", roofType: "METAL", label: "Z-bar / closures (lf/piece)", category: "Closures", kind: "lf_per_unit", inputMetric: "eavesLf", value: 10, unit: "piece" },
  { key: "metal.underlayment.squares_per_roll", roofType: "METAL", label: "Metal underlayment (squares/roll)", category: "Underlayment", kind: "squares_per_unit", inputMetric: "totalSquares", value: 10, unit: "roll" },
  { key: "metal.screws.sqft_per_bag", roofType: "METAL", label: "Screws/fasteners (sq ft/bag)", category: "Fasteners", kind: "squares_per_unit", inputMetric: "totalSquares", value: 8, unit: "bag" },
  { key: "metal.butyl.lf_per_roll", roofType: "METAL", label: "Butyl tape (lf/roll)", category: "Butyl Tape", kind: "lf_per_unit", inputMetric: "seamLf", value: 50, unit: "roll" },
  { key: "metal.pipeboots.per_penetration", roofType: "METAL", label: "Pipe boots per penetration", category: "Flashing", kind: "per_count", inputMetric: "penetrations", value: 1, unit: "each" },
  { key: "metal.sealant.squares_per_tube", roofType: "METAL", label: "Sealant (squares/tube)", category: "Sealant", kind: "squares_per_unit", inputMetric: "totalSquares", value: 12, unit: "tube" },

  // ── Flat / low-slope ─────────────────────────────────────────────────────
  // roofType: null → applies to the low-slope section of ANY roof (a shingle/tile
  // roof commonly has a flat porch or low-slope addition). Driven off flatSquares,
  // which the engine derives from the per-pitch table at the low-slope threshold
  // (planes <2/12), so these rules emit ONLY when low-slope area exists; on a
  // single-slope roof flatSquares is 0 and the engine skips them.
  //
  // Calibrated against SRS Quote 0047423240 (1061 NW 108th Ter): KNU's actual
  // low-slope assembly is a 3-layer Polyglass self-adhered modified-bitumen system
  // — granulated base + SBS SA ply + APP granulated cap. 0/12 area was 630 sqft
  // (6.3 sq); KNU ordered base 4 rl, ply 4 rl, cap 8 rl. Rates are EFFECTIVE
  // sq/roll (laps/waste baked in), so these categories are NOT re-wasted. See
  // estimates/CALIBRATION.md. (Single job — refine as more flat invoices land.)
  { key: "flat.base.squares_per_roll", roofType: null, label: "Flat base sheet (squares/roll)", category: "Flat Base Sheet", kind: "squares_per_unit", inputMetric: "flatSquares", value: 1.6, unit: "roll", description: "Calibrated (1061): Polyglass Elastobase V granulated base, 2 SQ/RL nominal; 4 rl for 6.3 sq → ~1.6 sq/rl effective." },
  { key: "flat.ply.squares_per_roll", roofType: null, label: "Flat SA ply sheet (squares/roll)", category: "Flat Ply Sheet", kind: "squares_per_unit", inputMetric: "flatSquares", value: 1.6, unit: "roll", description: "Calibrated (1061): Polyglass Elastoflex SA V SBS self-adhered ply, 2 SQ/RL nominal; 4 rl for 6.3 sq → ~1.6 sq/rl effective." },
  { key: "flat.cap.squares_per_roll", roofType: null, label: "Flat cap sheet (squares/roll)", category: "Flat Cap Sheet", kind: "squares_per_unit", inputMetric: "flatSquares", value: 0.8, unit: "roll", description: "Calibrated (1061): Polyglass Polyflex SA P APP granulated cap, 1 SQ/RL nominal; 8 rl for 6.3 sq → ~0.8 sq/rl effective (heavier cap laps)." },
];

export function defaultRulesFor(roofType: RoofType): RuleDef[] {
  return DEFAULT_RULES.filter((r) => r.roofType === roofType || r.roofType === null);
}
