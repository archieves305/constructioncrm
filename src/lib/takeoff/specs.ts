import type { RoofAssemblyType, RoofSpecsOutput } from "./ai/schemas";

/**
 * What `Takeoff.specs` holds. Client-safe types only. The model's reading
 * and a person's choice live side by side: the reading is never overwritten
 * by the choice, and a material line derived from a chosen assembly says so.
 */
export type RoofSpecsAi = RoofSpecsOutput & { aiCallId: string | null; promptVersion: string; sheets: string[]; at: string };

export type RoofAssemblyChoice = { type: RoofAssemblyType; description: string | null; byUserId: string; byName: string; at: string };

export type TakeoffSpecs = {
  roofing?: {
    ai?: RoofSpecsAi;
    choice?: RoofAssemblyChoice | null;
  };
};

/** The assembly in force: a person's choice first, else what the plans say. */
export function assemblyInForce(specs: TakeoffSpecs | null | undefined): { type: RoofAssemblyType; description: string | null; source: "choice" | "plans" } | null {
  const r = specs?.roofing;
  if (r?.choice) return { type: r.choice.type, description: r.choice.description, source: "choice" };
  if (r?.ai?.assembly) return { type: r.ai.assembly.type, description: r.ai.assembly.description, source: "plans" };
  return null;
}
