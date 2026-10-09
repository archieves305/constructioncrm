/**
 * What a measurement can be, per trade: the metric keys the engines read,
 * each with its kind and unit. Client-safe. A person drawing by hand picks
 * from this list; the AI (M3/M4) emits these keys and nothing else.
 */
export type MeasurementKindName = "AREA" | "LENGTH" | "COUNT";
export type TradeName = "ROOFING" | "PLUMBING";
export type Unit = "SF" | "LF" | "EA";

export type MetricDef = { key: string; label: string; kind: MeasurementKindName; unit: Unit; group: string; sized?: boolean };

export const UNIT_FOR_KIND: Record<MeasurementKindName, Unit> = { AREA: "SF", LENGTH: "LF", COUNT: "EA" };

export const METRICS: Record<TradeName, MetricDef[]> = {
  ROOFING: [
    { key: "roof.area", label: "Roof area", kind: "AREA", unit: "SF", group: "Areas" },
    { key: "roof.cricket", label: "Cricket area", kind: "AREA", unit: "SF", group: "Areas" },
    { key: "roof.parapet", label: "Parapet", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.eave", label: "Eave", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.rake", label: "Rake", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.ridge", label: "Ridge", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.hip", label: "Hip", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.valley", label: "Valley", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.wall", label: "Roof-to-wall", kind: "LENGTH", unit: "LF", group: "Edges" },
    { key: "roof.drain", label: "Primary drain", kind: "COUNT", unit: "EA", group: "Drainage" },
    { key: "roof.overflow", label: "Overflow / emergency drain", kind: "COUNT", unit: "EA", group: "Drainage" },
    { key: "roof.scupper", label: "Scupper", kind: "COUNT", unit: "EA", group: "Drainage" },
    { key: "roof.gutter", label: "Gutter", kind: "LENGTH", unit: "LF", group: "Drainage" },
    { key: "roof.downspout", label: "Downspout", kind: "COUNT", unit: "EA", group: "Drainage" },
    { key: "roof.penetration", label: "Penetration", kind: "COUNT", unit: "EA", group: "Openings" },
    { key: "roof.vent", label: "Plumbing vent", kind: "COUNT", unit: "EA", group: "Openings" },
    { key: "roof.curb", label: "Mechanical curb", kind: "COUNT", unit: "EA", group: "Openings" },
    { key: "roof.skylight", label: "Skylight", kind: "COUNT", unit: "EA", group: "Openings" },
  ],
  PLUMBING: [
    { key: "pipe.san", label: "Sanitary pipe", kind: "LENGTH", unit: "LF", group: "DWV", sized: true },
    { key: "pipe.vent", label: "Vent pipe", kind: "LENGTH", unit: "LF", group: "DWV", sized: true },
    { key: "pipe.sewer", label: "Building sewer", kind: "LENGTH", unit: "LF", group: "DWV", sized: true },
    { key: "pipe.cw", label: "Cold water", kind: "LENGTH", unit: "LF", group: "Water", sized: true },
    { key: "pipe.hw", label: "Hot water", kind: "LENGTH", unit: "LF", group: "Water", sized: true },
    { key: "pipe.hwr", label: "Hot water return", kind: "LENGTH", unit: "LF", group: "Water", sized: true },
    { key: "pipe.service", label: "Water service", kind: "LENGTH", unit: "LF", group: "Water", sized: true },
    { key: "pipe.gas", label: "Gas pipe", kind: "LENGTH", unit: "LF", group: "Gas", sized: true },
    { key: "fixture.WC", label: "Water closet", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.L", label: "Lavatory", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.BID", label: "Bidet", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.T", label: "Bathtub", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.SH", label: "Shower", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.KS", label: "Kitchen sink", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.DW", label: "Dishwasher", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.US", label: "Utility / laundry sink", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.WM", label: "Washing machine box", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.REF", label: "Refrigerator / ice maker", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.HB", label: "Hose bibb", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.FD", label: "Floor drain", kind: "COUNT", unit: "EA", group: "Fixtures" },
    { key: "fixture.WH", label: "Water heater", kind: "COUNT", unit: "EA", group: "Equipment" },
    { key: "device.cleanout", label: "Cleanout", kind: "COUNT", unit: "EA", group: "Devices" },
    { key: "device.aav", label: "Air admittance valve", kind: "COUNT", unit: "EA", group: "Devices" },
    { key: "device.vtr", label: "Vent through roof", kind: "COUNT", unit: "EA", group: "Devices" },
    { key: "device.wha", label: "Water hammer arrestor", kind: "COUNT", unit: "EA", group: "Devices" },
    { key: "device.valve", label: "Shutoff valve", kind: "COUNT", unit: "EA", group: "Devices" },
    { key: "device.regulator", label: "Gas regulator", kind: "COUNT", unit: "EA", group: "Gas" },
    { key: "gas.appliance", label: "Gas appliance", kind: "COUNT", unit: "EA", group: "Gas" },
  ],
};

export const TRADE_LABEL: Record<TradeName, string> = { ROOFING: "Roofing", PLUMBING: "Plumbing" };

export function metricFor(trade: TradeName, key: string): MetricDef | null {
  return METRICS[trade].find((m) => m.key === key) ?? null;
}

/** Pipe sizes a person can pick, inches. */
export const PIPE_SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8];

export const sizeLabel = (inches: number) => {
  const whole = Math.floor(inches);
  const frac = inches - whole;
  const f = frac === 0.5 ? "1/2" : frac === 0.25 ? "1/4" : frac === 0.75 ? "3/4" : "";
  return `${whole && f ? `${whole}-${f}` : whole || f}"`;
};
