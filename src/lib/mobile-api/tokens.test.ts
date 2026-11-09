import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTokens, CSS_PATH, OUT_PATH, oklchToHex } from "../../../mobile/scripts/tokens.mjs";

describe("phone app colours follow the web tokens", () => {
  it("mobile/src/ui/tokens.ts is what globals.css generates (run `node scripts/tokens.mjs` in mobile/)", () => {
    expect(readFileSync(OUT_PATH, "utf8")).toBe(buildTokens(readFileSync(CSS_PATH, "utf8")));
  });

  it("converts oklch the way the browser does", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#FFFFFF");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
    expect(oklchToHex("oklch(0.5 0 0)")).toBe("#636363");
    expect(oklchToHex("oklch(1 0 0 / 10%)")).toBe("#FFFFFF1A");
  });
});
